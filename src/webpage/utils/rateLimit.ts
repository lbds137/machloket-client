import {apiFetch, type ApiRequestInit} from "./apiFetch.js";
import {
	rateLimitHeld,
	rateLimitKey,
	rateLimitTicket,
	readBodyBounded,
	retryAfterMs,
	waitRateLimit,
} from "./rateLimitWindows.js";

export {retryAfterMs, retryAfterMsFromBody} from "./rateLimitWindows.js";

/** `fetch`, and on a 429 one more try after the window the server named. The second answer is
 * returned whatever it is. The 429's body is read from a clone, so the returned response still
 * carries its body. A call made inside a window another request armed, or behind calls still
 * queued on its bucket, waits its turn first (the registry in rateLimitWindows); calls of one
 * bucket go out in the order they were made, a retry after a 429 included. `shouldRetry` lets a
 * caller cancel its own send when the request became stale: asked when the window ends and again
 * when the 429 arrives, a false returns the 429 as it is (a synthesized 429 when the stale check
 * fails before the send).
 * A slowmode 429 (code 20016) is returned at once: its countdown is the caller's. */
export async function fetchRetryOnce(
	input: string,
	init?: ApiRequestInit,
	options?: {shouldRetry?: () => boolean; timeoutMs?: number},
): Promise<Response> {
	const fetchOpts = options?.timeoutMs !== undefined ? {timeoutMs: options.timeoutMs} : undefined;
	const stale = () => options?.shouldRetry?.() === false;
	const method = init?.method ?? "GET";
	// Its place in the bucket's order, kept for a retry after a 429.
	const ticket = rateLimitTicket();
	// A call nothing holds goes out synchronously (callers rely on that). The queue outlives its
	// last waiter until a later task, so a call made as earlier waiters resume is held behind them.
	if (rateLimitHeld(input, method)) {
		await waitRateLimit(input, method, ticket);
		if (stale()) {
			return new Response(
				JSON.stringify({message: "You are being rate limited.", retry_after: 0, global: false}),
				{status: 429, headers: {"Content-Type": "application/json"}},
			);
		}
	}
	const res = await apiFetch(input, init, fetchOpts);
	if (res.status !== 429) return res;
	const text = await readBodyBounded(res);
	let body: unknown;
	try {
		body = JSON.parse(text ?? "");
	} catch {
		// An unreadable body waits the default below.
	}
	if ((body as {code?: unknown} | null | undefined)?.code === 20016) return res;
	if (stale()) return res;
	// apiFetch armed the window from this body; an untracked URL (no API base) waits the body's own window.
	if (rateLimitKey(input, method)) {
		await waitRateLimit(input, method, ticket);
	} else {
		await new Promise((r) => setTimeout(r, retryAfterMs(429, text)!));
	}
	if (stale()) return res;
	return apiFetch(input, init, fetchOpts);
}
