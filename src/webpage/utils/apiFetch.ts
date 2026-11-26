import {type AccountAuth, accountOf, buildAccountHeaders} from "./accountHeaders.js";
import {pageNav} from "./netUtils.js";
import {armRateLimit, readBodyBounded} from "./rateLimitWindows.js";

/** Default budget (30 s) for authorized API calls. `timeoutMs: 0` opts out (large uploads). */
export const API_TIMEOUT_MS = 30_000;

export type ApiRequestInit = RequestInit & {timeoutMs?: number};

const PRE_AUTH_PATH =
	/(?:^|\/)(?:ping|instances\.json|\.well-known|policies\/instance|auth\/(?:login|register|forgot|reset|mfa|logout))(?:\/|$)/;

/** Whether `input` is a pre-auth endpoint (/ping, instance discovery, instance policies,
 * login/register/reset/2FA, and this token's own /auth/logout) exempt from 401 session
 * invalidation and routing. Logout's 401 means the token is already dead; the logout flow
 * (Specialuser.logout) owns that outcome — its retries end in a dialog whose continue removes
 * the account — and a probe-driven /login navigation here would race it. */
export function isPreAuthEndpoint(input: RequestInfo | URL): boolean {
	const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
	if (!URL.canParse(raw, window.location.href)) return false;
	const url = new URL(raw, window.location.href);
	return PRE_AUTH_PATH.test(url.pathname);
}

/** How a 401 path run ended. "dead": the session was confirmed dead and invalidated (and /login
 * scheduled while its account is the active one). "adopted": the session had moved into the
 * cookie and the account converted (onCookieSessionAdopted tells its holders). "notDead": no
 * verdict of death - the session answered the check alive (or a dead credential was kept by the
 * cookie layer); the session is left alone. "unanswered": the check itself produced no verdict
 * (a 429 or 5xx answer, a proxy's page or status, a timeout, a network error, or no usable API
 * to check against), a confirmed-dead credential's second look at the cookie layer got no
 * answer, or the death was confirmed but there was nothing to invalidate - no record still
 * holds the credential (a logout or a re-login elsewhere handled it); validity is unconfirmed,
 * the session is left alone here too, and the gateway Retry line names the difference
 * (TASK-172). "stale": a test reset superseded the run. */
export type UnauthorizedVerdict = "dead" | "adopted" | "notDead" | "stale" | "unanswered";
/** The credentials whose 401 probe is out, or whose confirmed death has scheduled the /login
 * navigation, each with its run's verdict (keys: latchKey). Keyed per account: an account switch
 * keeps the page, so the account switched to must not wait behind the old one's probe. And per
 * credential within it: a token READY swaps in while the old one's probe is out is a session of
 * its own, so its 401 is probed rather than handed the old token's verdict (TASK-169). */
const unauthorizedPending = new Map<string, Promise<UnauthorizedVerdict>>();
/** Whether a confirmed death has scheduled this page's /login navigation: one per page, however
 * many of an account's credentials are found dead before it leaves. Never cleared: pageNav.go
 * leaves the page, so the mark dies with it. */
let loginNavScheduled = false;
/** The latch key of the credential a request carried: a cookie account's session is its cookie,
 * a header account's its token. */
function latchKey(account: AccountAuth): string {
	return `${account.uid}\n${account.authMode === "cookie" ? "cookie" : `token:${account.token}`}`;
}
// Bumped only by resetUnauthorizedNavForTests, for test isolation: a probe left over from one
// test sees a new generation and never navigates in the next. Production never changes it.
let unauthorizedNavGen = 0;
/** The account this page runs (a Localuser registers it once its construction succeeds: boot
 * and every switch); undefined on pages that run none (the bot-authorize page, a boot whose
 * Localuser threw). */
let activeAccountUid: string | undefined;

/** Registers the account the page now runs: a dead session routes to /login only while its
 * account is the active one. */
export function noteActiveAccount(uid: string): void {
	activeAccountUid = uid;
}

/** Test-only reset: clears every credential's latch (released when the session proves alive, when
 * invalidation fails or the account is no longer the active one, and held once a confirmed dead
 * session schedules the /login navigation), the page's navigation mark and the registered active
 * account. */
export function resetUnauthorizedNavForTests(): void {
	unauthorizedPending.clear();
	loginNavScheduled = false;
	activeAccountUid = undefined;
	unauthorizedNavGen++;
}

/** What the instance says about the session behind a 401'd request: its auth middleware
 * rejects any request carrying a bad credential before routing, so a GET to the account's own
 * `<api>/users/@me` answers 401 for a dead session and 200 with a user-naming JSON body for a
 * live one. Endpoints can answer their own bare 401s for reasons that are not a dead session —
 * a wrong password on the delete/disable forms, a rejected TOTP verify — and those must never
 * log a valid account out. The probe goes only to the account's own API, never to the 401'd
 * request's host: it carries the account's current credential, which READY may have refreshed
 * since the request left. A 401 from outside that API (another host, or a path off its `/vN`
 * base), or an account with no known API, fails closed ("unanswered": no verdict about the
 * session came out of the check; the session is left alone, and such a 401 never auto-routes
 * to /login). Any other non-401 answer is "unanswered" too - a 429 rate-limited the check, a
 * 5xx never reached the middleware, a 403/404 is a proxy or a missing route - and so is a 200
 * whose body does not name a user: a verdict of life is the app's own answer, at
 * cookieSessionUserId's bar (TASK-172). Raw fetch (no apiFetch recursion), briefly timed. */
async function tokenIsDead(
	requestUrl: string,
	account: AccountAuth,
): Promise<"dead" | "alive" | "unanswered"> {
	try {
		const api = account.serverurls?.api;
		if (!api) return "unanswered";
		const apiUrl = new URL(api);
		const apiPath = apiUrl.pathname.replace(/\/+$/, "");
		const parsed = new URL(requestUrl, window.location.href);
		if (parsed.origin !== apiUrl.origin || !parsed.pathname.startsWith(apiPath + "/")) {
			return "unanswered";
		}
		const probe = await fetch(apiUrl.origin + apiPath + "/users/@me", {
			headers: buildAccountHeaders(account, {json: false}),
			signal: AbortSignal.timeout(10_000),
		});
		if (probe.status === 401) return "dead";
		// Any other status is no verdict about the session: a 429 rate-limited the check, a 5xx
		// never reached the middleware, a 403/404 is a proxy or a missing route - fetch answers
		// them all. The Retry line reports them as an unanswered check (TASK-172).
		if (probe.status !== 200) return "unanswered";
		// A verdict of life is the app's own answer, at cookieSessionUserId's bar: a JSON body
		// naming the user. A proxy's HTML maintenance page parses as neither.
		let id: unknown;
		try {
			id = (await probe.json())?.id;
		} catch {
			return "unanswered";
		}
		return typeof id === "string" && id ? "alive" : "unanswered";
	} catch {
		return "unanswered"; // The probe could not answer (or the URL never parsed); a bare 401 alone is not proof.
	}
}

/** Marks the account behind a VERIFIED dead session invalid and schedules one navigation to
 * /login. Only engages on a post-auth endpoint whose request was built for an account (bots,
 * pre-auth, and raw untagged requests never log anyone out), and invalidates only after the
 * probe confirms the account's current credential is dead. One probe per credential is in flight
 * at a time; its latch releases when the session proves alive so a later real death can still
 * route. A probe that outlives an account switch still invalidates its own account but routes
 * nowhere: /login would take the page from the account switched to. Returns whether the path
 * was engaged (the probe decides whether it will invalidate). */
export function handleUnauthorized(input: RequestInfo | URL, init?: RequestInit): boolean {
	return probeUnauthorized(input, init) !== undefined;
}

/** handleUnauthorized for a caller that acts on the outcome: the run's verdict, or undefined
 * when the path does not engage. While the credential's latch is held, the verdict is that run's -
 * a confirmed death stays "dead" until the /login navigation it scheduled. Never rejects. */
export function probeUnauthorized(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<UnauthorizedVerdict> | undefined {
	if (isPreAuthEndpoint(input)) return undefined;
	// The account object the headers were built from: its fields are read when the 401 is
	// handled, so a token READY replaced since the request was sent is the one probed.
	const account = accountOf(init);
	if (!account) return undefined;
	const uid = account.uid;
	// The credential as the probe sends it, taken now so the latch key and the probe agree:
	// invalidation compares against that very one, and a token READY swaps in while the probe is
	// out belongs to a session of its own (its own latch, its own probe).
	const probed: AccountAuth = {
		uid,
		token: account.token,
		authMode: account.authMode,
		id: account.id,
		serverurls: account.serverurls,
	};
	const key = latchKey(probed);
	const held = unauthorizedPending.get(key);
	if (held) return held;
	const gen = unauthorizedNavGen;
	const url = input instanceof Request ? input.url : String(input);
	// Every exit settles with a verdict: a caller waiting on it must never be left hanging.
	const run = (async (): Promise<UnauthorizedVerdict> => {
		// The latch is set below, once this first await hands control back: every release
		// inside comes after it, even a throw before the probe.
		await Promise.resolve();
		try {
			const checked = await tokenIsDead(url, probed);
			if (gen !== unauthorizedNavGen) return "stale";
			// No verdict of death releases the latch at once: a later 401 must not find it held.
			// "alive" keeps the "notDead" verdict; an unanswered check reports its own
			// "unanswered", which leaves the session alone too (TASK-172).
			if (checked !== "dead") {
				unauthorizedPending.delete(key);
				return checked === "alive" ? "notDead" : "unanswered";
			}
			// Loaded lazily so apiFetch stays a leaf module: utils.ts pulls in the whole app
			// graph, and a static import made any module that imports apiFetch before
			// localuser hit "Cannot access 'Guild' before initialization" (direct.ts).
			const utils = await import("./utils.js");
			if (gen !== unauthorizedNavGen) return "stale";
			// A header token that died because its session moved into the cookie (another
			// tab's migration, or a refused save of this one's) converts instead.
			const verdict = await utils.cookieVerdictFor401(probed);
			if (gen !== unauthorizedNavGen) return "stale";
			if (verdict === "adopted") {
				unauthorizedPending.delete(key);
				return "adopted";
			}
			if (verdict === "unanswered") {
				// The token probe confirmed death, but the cookie layer's second look got no
				// answer: validity unconfirmed, not proven - the Retry line says so (TASK-172).
				unauthorizedPending.delete(key);
				return "unanswered";
			}
			if (verdict !== "dead" || !utils.invalidateAccount(probed)) {
				// Not "notDead": nothing here says the session this page runs still holds. Either
				// the death was confirmed but no record holds the credential any more - a logout
				// or a re-login elsewhere already handled it, so there is nothing to invalidate
				// and /login could yank a page whose account re-logged-in - or a future verdict
				// of the cookie layer landed here unhandled, and the fail-closed answer is no
				// verdict (#232 review low).
				unauthorizedPending.delete(key);
				return "unanswered";
			}
			queueMicrotask(() => {
				if (gen !== unauthorizedNavGen) return;
				// The page switched to another account while the probe was out (checked here, at
				// the last moment: the switcher resumes in a microtask too): that account's
				// session is not the dead one. Released, so a fresh sign-in of this account that
				// later dies still routes.
				if (activeAccountUid !== undefined && activeAccountUid !== uid) {
					unauthorizedPending.delete(key);
					return;
				}
				if (loginNavScheduled) return;
				loginNavScheduled = true;
				pageNav.go("/login");
			});
			return "dead";
		} catch (error) {
			if (gen !== unauthorizedNavGen) return "stale";
			unauthorizedPending.delete(key);
			console.warn("machloket: 401 handling failed:", error);
			// The check could not run to a verdict: validity is unconfirmed, not proven.
			return "unanswered";
		}
	})();
	unauthorizedPending.set(key, run);
	return run;
}

/** Arms the window a 429 names (rateLimitWindows) from a clone of its body, so the body stays
 * unread for the caller. The read is capped at 1 s; an unreadable body arms the default wait.
 * Never throws. */
async function armRateLimitFrom429(
	input: RequestInfo | URL,
	res: Response,
	method: string | undefined,
): Promise<void> {
	try {
		const text = await readBodyBounded(res);
		let parsed: unknown;
		try {
			parsed = JSON.parse(text ?? "");
		} catch {
			// An unreadable body arms the default window.
		}
		armRateLimit(input, parsed, method, res.headers);
	} catch {
		// Arming is best-effort: the caller's own handling of the 429 stands.
	}
}

/** `fetch` with `redirect: "error"`, a 30 s timeout (`timeoutMs: 0` opts out), and 401
 * invalidation + debounced /login routing for post-auth token-bearing endpoints. */
export async function apiFetch(
	input: RequestInfo | URL,
	init?: ApiRequestInit,
	options?: {timeoutMs?: number},
): Promise<Response> {
	const {timeoutMs: initTimeoutMs, signal: initSignal, ...restInit} = init ?? {};
	const timeoutMs = options?.timeoutMs ?? initTimeoutMs ?? API_TIMEOUT_MS;
	if (timeoutMs <= 0) {
		// Untimed (an upload): the caller's own signal, if any, is fetch's own problem.
		const res = await fetch(input, {...restInit, redirect: "error", signal: initSignal});
		if (res.status === 401) handleUnauthorized(input, restInit);
		if (res.status === 429) await armRateLimitFrom429(input, res, restInit.method);
		return res;
	}
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	let signal: AbortSignal;
	if (!initSignal) {
		signal = timeoutSignal;
	} else if (AbortSignal.any) {
		signal = AbortSignal.any([initSignal, timeoutSignal]);
	} else {
		// AbortSignal.any is missing before Safari 17.4 / Firefox 124 / Chrome 116: forward both
		// signals, each with its own reason, onto a local controller. As on the .any path, the
		// forwarding outlives the headers (a streamed body read still cancels); the listener
		// pair drops when either signal fires, so within the budget at the latest.
		const controller = new AbortController();
		const onCallerAbort = () => {
			timeoutSignal.removeEventListener("abort", onTimeoutAbort);
			controller.abort(initSignal.reason);
		};
		const onTimeoutAbort = () => {
			initSignal.removeEventListener("abort", onCallerAbort);
			controller.abort(timeoutSignal.reason);
		};
		if (initSignal.aborted) {
			onCallerAbort();
		} else {
			initSignal.addEventListener("abort", onCallerAbort, {once: true});
			timeoutSignal.addEventListener("abort", onTimeoutAbort, {once: true});
		}
		signal = controller.signal;
	}

	let res: Response;
	try {
		res = await fetch(input, {...restInit, redirect: "error", signal});
	} catch (error) {
		if (timeoutSignal.aborted) {
			throw new DOMException("offline", "TimeoutError");
		}
		throw error;
	}

	if (res.status === 401) {
		handleUnauthorized(input, restInit);
	}
	if (res.status === 429) await armRateLimitFrom429(input, res, restInit.method);
	return res;
}

/** Wires the failure handler and (unless `timeoutMs: 0` opts out — the attachment upload
 * path) the 30 s timeout onto an authorized XHR send. `ontimeout` is wired either way: if a
 * stale path ever sets a timeout on an untimed request, the send must fail, not hang. */
export function configureApiXhr(
	xhr: XMLHttpRequest,
	onFail: () => void,
	timeoutMs = API_TIMEOUT_MS,
): void {
	xhr.onerror = onFail;
	xhr.ontimeout = onFail;
	if (timeoutMs > 0) {
		xhr.timeout = timeoutMs;
	}
}
