import {pageNav} from "./netUtils.js";
import {carryAccountsAcrossNavigation} from "./storage/settingOverlay.js";

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

function requestAuthToken(input: RequestInfo | URL, init?: RequestInit): string | null {
	const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
	if (!headers) return null;
	if (headers instanceof Headers) return headers.get("Authorization");
	if (Array.isArray(headers)) {
		const found = headers.find(([k]) => k.toLowerCase() === "authorization");
		return found ? found[1] : null;
	}
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === "authorization" && typeof v === "string") return v;
	}
	return null;
}

let unauthorizedNavPending = false;

/** Test-only reset: the latch is shared across all tokens (one in-flight probe for the whole
 * page, released when the token proves alive or invalidation fails, and held once a confirmed
 * dead token schedules the /login navigation); tests reset it between cases. */
export function resetUnauthorizedNavForTests(): void {
	unauthorizedNavPending = false;
}

/** Whether the token behind a 401'd request is really dead: the instance's auth middleware
 * rejects any request carrying a bad token before routing, so a GET to /users/@me under the
 * same /vN base answers 401 for a dead token and anything else for a live one. Endpoints
 * can answer their own bare 401s for reasons that are not a dead session — a wrong password
 * on the delete/disable forms, a rejected TOTP verify — and those must never log a valid
 * account out. When the URL has no recognizable /vN base, the probe cannot verify the token
 * and fails closed (leaves the session alone); the cost is that a truly dead token on such
 * an instance never auto-routes to /login — recovery is switching accounts or logging in
 * again. Raw fetch (no apiFetch recursion), briefly timed. */
async function tokenIsDead(requestUrl: string, token: string): Promise<boolean> {
	try {
		const parsed = new URL(requestUrl, window.location.href);
		const base = /^(.*?\/v\d+)(?=\/)/.exec(parsed.pathname)?.[0];
		// No recognizable API base: the probe cannot verify the token, so leave the session alone.
		if (!base) return false;
		const probe = await fetch(parsed.origin + base + "/users/@me", {
			headers: {Authorization: token},
			signal: AbortSignal.timeout(10_000),
		});
		return probe.status === 401;
	} catch {
		return false; // The probe could not answer (or the URL never parsed); a bare 401 alone is not proof.
	}
}

/** Marks the account behind a VERIFIED dead token invalid and schedules one navigation to
 * /login. Only engages on a post-auth endpoint whose request carried a token (a token-less
 * 401 — a CDN PUT, a 2FA attempt — never logs anyone out), and invalidates only after the
 * probe confirms the token is dead. One probe is in flight at a time; the latch releases
 * when the token proves alive so a later real death can still route. Returns whether the
 * path was engaged (not whether it will invalidate — the probe decides that). */
export function handleUnauthorized(input: RequestInfo | URL, init?: RequestInit): boolean {
	if (isPreAuthEndpoint(input)) return false;
	const token = requestAuthToken(input, init);
	if (token === null) return false;
	if (unauthorizedNavPending) return true;
	unauthorizedNavPending = true;
	const url = input instanceof Request ? input.url : String(input);
	void tokenIsDead(url, token).then(async (dead) => {
		try {
			// Loaded lazily so apiFetch stays a leaf module: utils.ts pulls in the whole app
			// graph, and a static import made any module that imports apiFetch before
			// localuser hit "Cannot access 'Guild' before initialization" (direct.ts).
			if (!dead || !(await import("./utils.js")).invalidateAccount(token)) {
				unauthorizedNavPending = false;
				return;
			}
			queueMicrotask(() => {
				carryAccountsAcrossNavigation();
				pageNav.go("/login");
			});
		} catch (error) {
			unauthorizedNavPending = false;
			console.warn("machloket: 401 handling failed:", error);
		}
	});
	return true;
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
