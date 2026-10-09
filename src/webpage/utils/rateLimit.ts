/** A 429's wait in ms, or null for any other status. Spacebar's body carries retry_after in
 * SECONDS (a number, or a numeric string); a missing or unreadable body waits 5 s. Capped for sanity. */
export function retryAfterMs(status: number, bodyText: string | null, cap = 30_000): number | null {
	if (status !== 429) return null;
	let seconds = 5;
	try {
		const raw = (JSON.parse(bodyText ?? "") as {retry_after?: unknown}).retry_after;
		const retry = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
		if (typeof retry === "number" && retry >= 0) seconds = retry;
	} catch {
		// A non-JSON 429 keeps the default.
	}
	return Math.min(seconds * 1000, cap);
}

/** `fetch`, and on a 429 one more try after the window the server named. The second answer is
 * returned whatever it is; the first answer's body is spent on reading the window. */
export async function fetchRetryOnce(input: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(input, init);
	if (res.status !== 429) return res;
	const wait = retryAfterMs(429, await res.text().catch(() => null))!;
	await new Promise((r) => setTimeout(r, wait));
	return fetch(input, init);
}
