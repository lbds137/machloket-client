/** The client's one 429 window registry. A window is keyed by the API base (origin plus the path
 * up to `/vN`) and, for a route, by its bucket. The bucket mirrors the server's per-route limiter
 * key: the METHOD and the route pattern with the canonical major id, so
 * `GET channels/1/messages` and `GET channels/2/messages` are separate buckets, and a message's
 * reactions collapse to one `:id`/`:emoji` pattern per channel. A `global` 429 (the server's `global` and `ip`
 * buckets) covers every route of its base. One known gap: the server's `error` limiter (IP-wide,
 * every route, counts 4xx) reports `global: false`, so its 429 is filed under the request's path
 * only. Windows are read from the 429's body alone: the server sends no rate-limit headers to a
 * cross-origin client. */

/** A 429's wait in ms, or null for any other status. Spacebar's body carries retry_after in
 * SECONDS (a number, or a numeric string); a missing or unreadable body waits 5 s. Capped for sanity. */
export function retryAfterMs(status: number, bodyText: string | null, cap = 30_000): number | null {
	if (status !== 429) return null;
	let body: unknown = null;
	try {
		body = JSON.parse(bodyText ?? "");
	} catch {
		// A non-JSON 429 keeps the default.
	}
	return retryAfterMsFromBody(body, cap);
}

/** The same window read from a body that is already parsed (the XHR path's `response`). */
export function retryAfterMsFromBody(body: unknown, cap = 30_000): number {
	let seconds = 5;
	const raw = (body as {retry_after?: unknown} | null | undefined)?.retry_after;
	const retry = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
	if (typeof retry === "number" && retry >= 0) seconds = retry;
	return Math.min(seconds * 1000, cap);
}

/** The API base and bucket of a request, or null when it is not an API call (no `/vN`
 * segment): such a URL is never armed and never waited on. The base is origin + the path up to
 * and including the first `/vN`; the bucket is the rest of the path, percent-decoded (raw on a
 * bad escape), lowercased, trailing slashes stripped. */
export function rateLimitKey(
	input: RequestInfo | URL,
	method?: string,
): {base: string; bucket: string} | null {
	const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
	const verb = method ?? (input instanceof Request ? input.method : "GET");
	let url: URL;
	try {
		url = new URL(raw, location.href);
	} catch {
		return null;
	}
	const match = /^(.*?\/v\d+)(?=\/)/.exec(url.pathname);
	if (!match) return null;
	// Split first, then decode each segment: an encoded slash stays inside its segment.
	const rest = url.pathname.slice(match[0].length).replace(/\/+$/, "").replace(/^\/+/, "");
	const parts = (rest === "" ? [] : rest.split("/")).map((segment) => {
		let decoded = segment;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			// A bad escape keeps the segment as sent.
		}
		return decoded.toLowerCase();
	});
	const canon: string[] = [];
	let i = 0;
	// Under a major root the major id stays (and a webhook's token, its second segment).
	if (parts.length && MAJOR_ROOTS.has(parts[0])) {
		const keep = parts[0] === "webhooks" ? 3 : 2;
		for (; i < Math.min(parts.length, keep); i++) canon.push(parts[i]);
	}
	for (; i < parts.length; i++) {
		if (i > 0 && parts[i - 1] === "reactions") canon.push(":emoji");
		else if (/^\d+$/.test(parts[i])) canon.push(":id");
		else canon.push(parts[i]);
	}
	return {
		base: url.origin + match[1],
		bucket: verb.toUpperCase() + " " + canon.join("/"),
	};
}

/** The roots whose first id is the major id the server's limiter keys on. */
const MAJOR_ROOTS = new Set(["channels", "guilds", "webhooks"]);

/** The end (ms since the epoch) of each global window, by base. */
const globalUntil = new Map<string, number>();
/** The end of each route's window, by base and bucket (a JSON pair: no separator can clash). */
const bucketUntil = new Map<string, number>();
/** A caller parked on a bucket: its place in send order and the resolver that resumes it. */
type Waiter = {ticket: number; wake: () => void};
/** A bucket's parked callers, lowest ticket first; `pumping` is true while a pump is waiting the
 * bucket's windows out for them. */
type BucketQueue = {waiters: Waiter[]; pumping: boolean};
/** Each bucket's queue (same key as `bucketUntil`). */
const queues = new Map<string, BucketQueue>();
/** The last ticket handed out: tickets only grow, so a lower one was taken earlier. */
let lastTicket = 0;

/** A place in send order. A caller takes one when its request starts and gives it to every
 * `waitRateLimit` for that request, so a re-entry after a 429 resumes ahead of the calls that
 * started later and are parked on the bucket when it opens, whatever order their 429s came back
 * in. It holds no place before the caller parks: a later call already released, or on the wire,
 * is not called back. */
export function rateLimitTicket(): number {
	return ++lastTicket;
}

/** Drops every window whose end has passed, so windows for routes nobody asks again don't pile up. */
function sweepExpired(): void {
	const now = Date.now();
	for (const [base, end] of globalUntil) if (end <= now) globalUntil.delete(base);
	for (const [id, end] of bucketUntil) if (end <= now) bucketUntil.delete(id);
}

/** Keeps the later of an armed end and a new one: a window is never shortened. */
function extend(windows: Map<string, number>, key: string, until: number): void {
	windows.set(key, Math.max(windows.get(key) ?? 0, until));
}

/** Arms the window a 429's body names for the request's route, or for its whole base when the
 * body says `global: true`. A slowmode body (code 20016) never arms a window: Discord answers
 * slowmode with a 429 too, and its own countdown owns that wait. A request that is not an API
 * call arms nothing. */
export function armRateLimit(input: RequestInfo | URL, body: unknown, method?: string): void {
	const key = rateLimitKey(input, method);
	if (!key) return;
	if ((body as {code?: unknown} | null | undefined)?.code === 20016) return;
	sweepExpired();
	const until = Date.now() + retryAfterMsFromBody(body);
	if ((body as {global?: unknown} | null | undefined)?.global === true) {
		extend(globalUntil, key.base, until);
	} else {
		extend(bucketUntil, JSON.stringify([key.base, key.bucket]), until);
	}
}

/** Milliseconds left on the later of the base's global window and the request's route window;
 * 0 when neither is armed, or when the request is not an API call. Expired entries are dropped
 * as they are found. */
export function rateLimitRemaining(input: RequestInfo | URL, method?: string): number {
	const key = rateLimitKey(input, method);
	return key ? remainingFor(key) : 0;
}

/** `rateLimitRemaining` for a key already read (a waiter keeps the key it was queued under). */
function remainingFor(key: {base: string; bucket: string}): number {
	const now = Date.now();
	const ends: number[] = [];
	const globalEnd = globalUntil.get(key.base);
	if (globalEnd !== undefined) {
		if (globalEnd > now) ends.push(globalEnd);
		else globalUntil.delete(key.base);
	}
	const bucketId = JSON.stringify([key.base, key.bucket]);
	const bucketEnd = bucketUntil.get(bucketId);
	if (bucketEnd !== undefined) {
		if (bucketEnd > now) ends.push(bucketEnd);
		else bucketUntil.delete(bucketId);
	}
	return ends.length ? Math.max(...ends) - now : 0;
}

/** Whether `waitRateLimit(input)` would hold the caller: a window is armed for the request, or
 * earlier callers are still queued on its bucket. False for a request that is not an API call. */
export function rateLimitHeld(input: RequestInfo | URL, method?: string): boolean {
	const key = rateLimitKey(input, method);
	if (!key) return false;
	return queues.has(JSON.stringify([key.base, key.bucket])) || remainingFor(key) > 0;
}

/** Resolves once the request's windows are over and every waiter on the same bucket with a
 * lower ticket has resumed. Callers that take a fresh ticket here resume first-in, first-out,
 * even one that arrives after the window ended while earlier waiters are still parked; a caller
 * re-entering with the ticket its request started with (a resend after a 429) resumes ahead of
 * the calls that started later. A window extended while the caller waits makes it wait again.
 * A caller that sends synchronously once this resolves sends in that order too. The bucket's
 * queue outlives its last waiter until a later timer task, so a call made while resumed waiters
 * are still on their way to sending is held behind them (`rateLimitHeld` is true for it, so a
 * stale caller gets the synthesized 429 instead of sending). */
export async function waitRateLimit(
	input: RequestInfo | URL,
	method?: string,
	ticket: number = rateLimitTicket(),
): Promise<void> {
	const key = rateLimitKey(input, method);
	if (!key) return;
	const id = JSON.stringify([key.base, key.bucket]);
	let queue = queues.get(id);
	if (!queue && remainingFor(key) === 0) return;
	if (!queue) {
		queue = {waiters: [], pumping: false};
		queues.set(id, queue);
	}
	const parked = queue;
	await new Promise<void>((wake) => {
		const at = parked.waiters.findIndex((w) => w.ticket > ticket);
		parked.waiters.splice(at < 0 ? parked.waiters.length : at, 0, {ticket, wake});
		if (!parked.pumping) void pump(id, key, parked);
	});
}

/** Waits the bucket's windows out, then resumes its parked callers lowest ticket first, all in
 * one task (each in a later microtask, in that order). A caller parked while the pump waits
 * takes its ticket's place in the line. Once the queue is empty it stays registered until a
 * later timer task, then goes unless a caller parked meanwhile. */
async function pump(id: string, key: {base: string; bucket: string}, queue: BucketQueue) {
	queue.pumping = true;
	while (queue.waiters.length) {
		for (let remaining = remainingFor(key); remaining > 0; remaining = remainingFor(key)) {
			await new Promise<void>((resolve) => setTimeout(resolve, remaining));
		}
		queue.waiters.shift()!.wake();
	}
	queue.pumping = false;
	// Dropped in a later timer task, not here: the waiters resumed now send during this task's
	// microtasks, and a call made meanwhile must queue behind them instead of going out unheld.
	setTimeout(() => {
		if (queues.get(id) === queue && !queue.pumping && !queue.waiters.length) queues.delete(id);
	}, 0);
}

/** The text of a response's body, read from a clone (the response keeps its body) and capped at
 * `ms`: null when it is unreadable or slower than the cap. The cap's timer is cleared as soon as
 * the read settles. Never throws. */
export async function readBodyBounded(res: Response, ms = 1000): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			res
				.clone()
				.text()
				.catch(() => null),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), ms);
			}),
		]);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Test-only: how many windows (global and bucket) the registry holds, expired ones included. */
export function rateLimitWindowCountForTests(): number {
	return globalUntil.size + bucketUntil.size;
}

/** Test-only: how many callers are parked on the request's bucket line (0 when it has none). */
export function rateLimitWaiterCountForTests(input: RequestInfo | URL, method?: string): number {
	const key = rateLimitKey(input, method);
	if (!key) return 0;
	return queues.get(JSON.stringify([key.base, key.bucket]))?.waiters.length ?? 0;
}

/** Test-only reset: forgets every window and every bucket queue. A pump still sleeping finds its
 * line empty when it wakes, so it never releases an earlier test's caller into a later test. A
 * caller still parked from an earlier test is dropped from the line and never settles, so a test
 * must not leave a call awaiting a window. */
export function resetRateLimitsForTests(): void {
	globalUntil.clear();
	bucketUntil.clear();
	for (const queue of queues.values()) queue.waiters.length = 0;
	queues.clear();
}
