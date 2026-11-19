import {pageNav} from "./netUtils.js";
import {carryAccountsAcrossNavigation} from "./storage/settingOverlay.js";
import {invalidateAccount} from "./utils.js";

/** Default budget (30 s) for authorized API calls. `timeoutMs: 0` opts out (large uploads). */
export const API_TIMEOUT_MS = 30_000;

export type ApiRequestInit = RequestInit & {timeoutMs?: number};

const PRE_AUTH_PATH =
	/(?:^|\/)(?:ping|instances\.json|\.well-known|policies\/instance|auth\/(?:login|register|forgot|reset|mfa))(?:\/|$)/;

/** Whether `input` is a pre-auth endpoint (/ping, instance discovery, instance policies,
 * login/register/reset/2FA) exempt from 401 session invalidation and routing. */
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

/** Test-only reset: the nav latch holds for the page's lifetime in production (the /login
 * navigation reloads the module); tests reset it between cases. Only test code calls this. */
export function resetUnauthorizedNavForTests(): void {
	unauthorizedNavPending = false;
}

/** Whether the token behind a 401'd request is really dead: the instance's auth middleware
 * rejects any request carrying a bad token before routing, so a GET to /users/@me under the
 * same /api/vN base answers 401 for a dead token and anything else for a live one. Endpoints
 * can answer their own bare 401s for reasons that are not a dead session — a wrong password
 * on the delete/disable forms, a rejected TOTP verify — and those must never log a valid
 * account out. Raw fetch (no apiFetch recursion), briefly timed. */
async function tokenIsDead(requestUrl: string, token: string): Promise<boolean> {
	const parsed = new URL(requestUrl, window.location.href);
	const base = /\/api\/v\d+(?=\/)/.exec(parsed.pathname)?.[0];
	if (!base) return true; // Not a recognizable API path: fall back to acting on the 401.
	try {
		const probe = await fetch(parsed.origin + base + "/users/@me", {
			headers: {Authorization: token},
			signal: AbortSignal.timeout(10_000),
		});
		return probe.status === 401;
	} catch {
		return false; // The probe could not answer; a bare 401 alone is not proof.
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
	void tokenIsDead(url, token).then((dead) => {
		if (!dead || !invalidateAccount(token)) {
			unauthorizedNavPending = false;
			return;
		}
		queueMicrotask(() => {
			carryAccountsAcrossNavigation();
			pageNav.go("/login");
		});
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
	// AbortSignal.any is missing before Safari 17.4 / Firefox 124 / Chrome 116; without it the
	// caller's signal alone is used (the race below still turns a timeout into the refusal).
	const signal = initSignal
		? AbortSignal.any
			? AbortSignal.any([initSignal, timeoutSignal])
			: initSignal
		: timeoutSignal;

	let onAbort: (() => void) | undefined;
	const abortPromise = new Promise<never>((_, reject) => {
		const fail = () => {
			reject(
				timeoutSignal.aborted
					? new DOMException("offline", "TimeoutError")
					: (signal.reason ?? new DOMException("aborted", "AbortError")),
			);
		};
		if (signal.aborted) {
			fail();
			return;
		}
		onAbort = fail;
		signal.addEventListener("abort", onAbort, {once: true});
	});

	let res: Response;
	try {
		res = await Promise.race([
			fetch(input, {...restInit, redirect: "error", signal}),
			abortPromise,
		]);
	} catch (error) {
		if (timeoutSignal.aborted) {
			throw new DOMException("offline", "TimeoutError");
		}
		throw error;
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
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
