import {describe, expect, it, vi} from "vitest";
import {
	armRateLimit,
	rateLimitKey,
	rateLimitRemaining,
	rateLimitWindowCountForTests,
	waitRateLimit,
} from "./rateLimitWindows";

// The registry is standalone (no app module needed): the suite's beforeEach resets it.
const A = "http://kn.test/api/v9";

describe("rateLimitKey", () => {
	it("normalizes the query, case, trailing slashes and percent-escapes of the path", () => {
		expect(rateLimitKey(A + "/Channels/%31/Messages/?limit=5")).toEqual({
			base: A,
			bucket: "GET channels/1/messages",
		});
	});

	it("keeps a bad percent-escape raw", () => {
		expect(rateLimitKey(A + "/x%E0%A4%A")).toEqual({base: A, bucket: "GET x%e0%a4%a"});
	});

	it("is null for a URL with no /vN segment (not an API call)", () => {
		expect(rateLimitKey("http://kn.test/instances.json")).toBeNull();
	});

	// The server's counter key: METHOD + the route pattern + the canonical major id.
	it("reads the three documented examples", () => {
		expect(rateLimitKey(A + "/channels/12/messages?limit=100")?.bucket).toBe(
			"GET channels/12/messages",
		);
		expect(
			rateLimitKey(A + "/channels/12/messages/34/reactions/%F0%9F%91%8D/@me", "PUT")?.bucket,
		).toBe("PUT channels/12/messages/:id/reactions/:emoji/@me");
		expect(rateLimitKey(A + "/channels/12/messages", "POST")?.bucket).toBe(
			"POST channels/12/messages",
		);
	});

	it("keeps a webhook's token segment and collapses the ids after it", () => {
		expect(rateLimitKey(A + "/webhooks/7/tok3n/messages/99")?.bucket).toBe(
			"GET webhooks/7/tok3n/messages/:id",
		);
	});

	it("two message ids on one channel share a reactions bucket, two channels don't", () => {
		const react = (channel: string, message: string) =>
			rateLimitKey(A + `/channels/${channel}/messages/${message}/reactions/%F0%9F%91%8D/@me`, "PUT")
				?.bucket;
		expect(react("12", "34")).toBe(react("12", "35"));
		expect(react("12", "34")).not.toBe(react("13", "34"));
	});

	it("GET and POST on one path are separate buckets", () => {
		expect(rateLimitKey(A + "/channels/12/messages", "POST")?.bucket).not.toBe(
			rateLimitKey(A + "/channels/12/messages")?.bucket,
		);
	});

	it("a Request input uses its own method", () => {
		const req = new Request(A + "/channels/12/messages", {method: "POST"});
		expect(rateLimitKey(req)?.bucket).toBe("POST channels/12/messages");
	});
});

describe("the registry's windows", () => {
	it("a global window arms every bucket of its base, and no other base", () => {
		armRateLimit(A + "/channels/1/messages", {global: true, retry_after: 0.2});

		expect(rateLimitRemaining(A + "/channels/1/messages")).toBeGreaterThan(0);
		expect(rateLimitRemaining(A + "/guilds/9")).toBeGreaterThan(0);
		expect(rateLimitRemaining("http://other.test/api/v9/guilds/9")).toBe(0);
	});

	it("a bucket window arms only its own path", () => {
		armRateLimit(A + "/channels/1/messages", {retry_after: 0.2});

		expect(rateLimitRemaining(A + "/channels/1/messages?limit=100")).toBeGreaterThan(0);
		expect(rateLimitRemaining(A + "/channels/2/messages")).toBe(0);
		expect(rateLimitRemaining(A + "/guilds/9")).toBe(0);
	});

	it("a slowmode body (code 20016) never arms a window, even when global", () => {
		armRateLimit(A + "/channels/1/messages", {code: 20016, global: true, retry_after: 0.2});

		expect(rateLimitRemaining(A + "/channels/1/messages")).toBe(0);
		expect(rateLimitRemaining(A + "/guilds/9")).toBe(0);
	});

	it("a shorter window never shortens an armed one", () => {
		armRateLimit(A + "/channels/1/messages", {retry_after: 0.3});
		armRateLimit(A + "/channels/1/messages", {retry_after: 0.05});

		expect(rateLimitRemaining(A + "/channels/1/messages")).toBeGreaterThan(150);
	});
});

describe("waitRateLimit", () => {
	it("resumes its callers in the order they started waiting", async () => {
		armRateLimit(A + "/channels/1/messages", {retry_after: 0.1});
		const order: string[] = [];

		const a = waitRateLimit(A + "/channels/1/messages").then(() => order.push("a"));
		const b = waitRateLimit(A + "/channels/1/messages").then(() => order.push("b"));
		await Promise.all([a, b]);

		expect(order).toEqual(["a", "b"]);
	});

	/** Runs `body` with setTimeout faked and Date.now read from `clock.now`; `clock.skew` is
	 * subtracted from the next read only (a timer that fires a tick before the wall clock). */
	async function withClock(
		body: (clock: {now: number; skew: number}) => Promise<void>,
	): Promise<void> {
		const clock = {now: 1_000_000, skew: 0};
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		const spy = vi.spyOn(Date, "now").mockImplementation(() => {
			const t = clock.now - clock.skew;
			clock.skew = 0;
			return t;
		});
		try {
			await body(clock);
		} finally {
			spy.mockRestore();
			vi.useRealTimers();
		}
	}

	// RED (TASK-92): at HEAD the first waiter re-checks, sees 1 ms left and re-arms; the second sees 0 and goes first.
	it("keeps its callers in order when the timer fires a tick before the window's end", async () => {
		await withClock(async (clock) => {
			const url = A + "/channels/1/messages";
			armRateLimit(url, {retry_after: 0.1});
			const order: string[] = [];
			const a = waitRateLimit(url).then(() => order.push("a"));
			const b = waitRateLimit(url).then(() => order.push("b"));
			await vi.advanceTimersByTimeAsync(0); // the waiters' first checks run and arm their timers
			expect(vi.getTimerCount()).toBeGreaterThan(0);

			clock.now += 100;
			clock.skew = 1;
			await vi.advanceTimersByTimeAsync(100);
			// The first wake read 1 ms left: nobody has resumed yet.
			expect(order).toEqual([]);
			await vi.advanceTimersByTimeAsync(10);
			await Promise.all([a, b]);

			expect(order).toEqual(["a", "b"]);
		});
	});

	// RED (TASK-92): at HEAD a caller arriving after the window's end, before the first waiter's
	// timer has run, sees 0 left and overtakes it.
	it("queues a caller behind earlier waiters even once the window has ended", async () => {
		await withClock(async (clock) => {
			const url = A + "/channels/1/messages";
			armRateLimit(url, {retry_after: 0.1});
			const order: string[] = [];
			const a = waitRateLimit(url).then(() => order.push("a"));
			await vi.advanceTimersByTimeAsync(0); // a's first check runs and arms its timer
			expect(vi.getTimerCount()).toBe(1);

			clock.now += 100;
			const b = waitRateLimit(url).then(() => order.push("b"));
			await vi.advanceTimersByTimeAsync(100);
			await Promise.all([a, b]);

			expect(order).toEqual(["a", "b"]);
		});
	});

	it("a queue on one bucket never holds a caller on another", async () => {
		await withClock(async (clock) => {
			armRateLimit(A + "/channels/1/messages", {retry_after: 0.1});
			const order: string[] = [];
			const a = waitRateLimit(A + "/channels/1/messages").then(() => order.push("a"));
			const b = waitRateLimit(A + "/channels/2/messages").then(() => order.push("b"));

			await b;
			expect(order).toEqual(["b"]);
			clock.now += 100;
			await vi.advanceTimersByTimeAsync(100);
			await a;
		});
	});

	it("waits again when the window was extended while it waited", async () => {
		const url = A + "/channels/1/messages";
		armRateLimit(url, {retry_after: 0.1});
		const started = Date.now();
		const waited = waitRateLimit(url);
		armRateLimit(url, {retry_after: 0.25});

		await waited;

		expect(Date.now() - started).toBeGreaterThanOrEqual(200);
		expect(rateLimitRemaining(url)).toBe(0);
	});

	// PIN (TASK-92 review c): a global window armed while a bucket's callers wait holds them all
	// to its end, and they still resume in the order they started waiting.
	it("a global window armed over a bucket's waiters holds them to its end, still in order", async () => {
		const url = A + "/channels/1/messages";
		armRateLimit(url, {retry_after: 0.05});
		const started = Date.now();
		const order: string[] = [];
		const a = waitRateLimit(url).then(() => order.push("a"));
		const b = waitRateLimit(url).then(() => order.push("b"));
		armRateLimit(A + "/users/@me", {global: true, retry_after: 0.2});

		await Promise.all([a, b]);

		expect(order).toEqual(["a", "b"]);
		expect(Date.now() - started).toBeGreaterThanOrEqual(190);
	});
});

describe("rateLimitKey review fixes", () => {
	// RED (A3): at HEAD a Request's own method wins over the explicit one.
	it("an explicit method wins over a Request's own method", () => {
		const req = new Request(A + "/channels/12/messages");
		expect(rateLimitKey(req, "POST")?.bucket.startsWith("POST ")).toBe(true);
	});

	// RED (A4): at HEAD URL.canParse is called, so a browser without it throws instead of keying.
	it("does not depend on URL.canParse (older browsers lack it)", () => {
		const canParse = Object.getOwnPropertyDescriptor(URL, "canParse");
		Object.defineProperty(URL, "canParse", {value: undefined, configurable: true, writable: true});
		try {
			expect(rateLimitKey(A + "/channels/12/messages")?.bucket).toBe("GET channels/12/messages");
			expect(rateLimitKey("http://[bad")).toBeNull();
		} finally {
			if (canParse) Object.defineProperty(URL, "canParse", canParse);
			else delete (URL as {canParse?: unknown}).canParse;
		}
	});

	// RED (A5): at HEAD the whole path is decoded before splitting, so an encoded slash splits.
	it("an encoded slash inside one segment stays one segment", () => {
		expect(rateLimitKey(A + "/channels/1/messages/2/reactions/a%2Fb/@me", "PUT")?.bucket).toBe(
			"PUT channels/1/messages/:id/reactions/:emoji/@me",
		);
	});

	// RED (A6): at HEAD expired windows are never swept, so the count still holds the dead two.
	it("arming sweeps expired windows, so only live ones are held", async () => {
		armRateLimit(A + "/channels/1/messages", {retry_after: 0.01});
		armRateLimit(A + "/channels/2/messages", {retry_after: 0.01});
		await new Promise((r) => setTimeout(r, 40));

		armRateLimit(A + "/channels/3/messages", {retry_after: 5});

		expect(rateLimitWindowCountForTests()).toBe(1);
	});
});
