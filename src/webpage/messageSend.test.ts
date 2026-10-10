import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel, createMachloketNonce} = await import("./channel");

/** An XMLHttpRequest that answers every send with `status` and `response`. */
function fakeXHR(status: number, response: unknown) {
	return class {
		status = 0;
		response: unknown = null;
		responseType = "";
		upload = {onprogress: null};
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		open() {}
		setRequestHeader() {}
		send() {
			this.status = status;
			this.response = response;
			queueMicrotask(() => this.onload?.());
		}
	};
}

/**
 * An XMLHttpRequest whose sends answer in turn from `answers` (the last answer repeats once they
 * run out, so an extra send shows up in `sent`). `sent` holds every request body, in order.
 */
function fakeXHRSequence(answers: {status: number; response: unknown}[]) {
	const sent: unknown[] = [];
	class FakeXHR {
		status = 0;
		response: unknown = null;
		responseType = "";
		upload = {onprogress: null};
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		open() {}
		setRequestHeader() {}
		send(body: unknown) {
			const answer = answers[Math.min(sent.length, answers.length - 1)];
			sent.push(body);
			this.status = answer.status;
			this.response = answer.response;
			queueMicrotask(() => this.onload?.());
		}
	}
	return {XHR: FakeXHR, sent};
}

/** One animation frame: real time, so it still ticks while setTimeout is faked. */
const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
/** Waits (in frames, not timers) until `sent` holds `count` requests. */
async function untilSent(sent: unknown[], count: number) {
	for (let i = 0; i < 60 && sent.length < count; i++) await frame();
}

/** A channel whose pending-message bubble is a set of spies. */
function sendingChannel() {
	const bubble = {progress: vi.fn(), failed: vi.fn(), void: vi.fn()};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {info: {api: "http://send.test/api/v9"}},
		headers: {"Content-type": "application/json", Authorization: "t"},
		makeFakeMessage: vi.fn(async () => bubble),
		slowmode: vi.fn(),
	}) as InstanceType<typeof Channel>;
	return {channel, bubble};
}

afterEach(() => vi.unstubAllGlobals());

describe("a message the server refuses", () => {
	it("(slowmode (a JSON error body)) removes its bubble once, with no retry left on a removed bubble", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(429, {code: 20016, message: "Slowmode"}));
		const {channel, bubble} = sendingChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));

		expect(bubble.void).toHaveBeenCalledTimes(1);
		expect(bubble.failed).not.toHaveBeenCalled();
	});

	// MODIFY: a 429 whose body isn't JSON used to answer NotOk at once; it now waits the 5 s
	// default, asks once more, and the second answer is final.
	it("(a body that isn't JSON) removes its bubble once, after one retry, with no retry left on a removed bubble", async () => {
		const {XHR, sent} = fakeXHRSequence([
			{status: 429, response: null},
			{status: 429, response: null},
		]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = sendingChannel();
		const answers: string[] = [];
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		try {
			void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
			await untilSent(sent, 1);
			await vi.advanceTimersByTimeAsync(5000);
			await untilSent(sent, 2);
			await frame();
		} finally {
			vi.useRealTimers();
		}

		expect(sent).toHaveLength(2);
		expect(answers).toEqual(["NotOk"]);
		expect(bubble.void).toHaveBeenCalledTimes(1);
		expect(bubble.failed).not.toHaveBeenCalled();
	});

	it("settles the send, so a caller awaiting it (opening a DM with a message) isn't stuck", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(403, {code: 50013, message: "Missing Permissions"}));
		const {channel} = sendingChannel();

		const settled = await Promise.race([
			channel.sendMessage("hi", {nonce: "n1"}).then(() => "settled"),
			new Promise((res) => setTimeout(() => res("hung"), 1000)),
		]);

		expect(settled).toBe("settled");
	});

	it("a slowmode refusal starts the slowmode countdown", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(429, {code: 20016, message: "Slowmode"}));
		const {channel} = sendingChannel();
		Object.defineProperty(channel, "localuser", {value: {channelfocus: channel}});
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));

		expect(channel.slowmode).toHaveBeenCalledWith(true);
	});
});

describe("a send the server rate-limits", () => {
	let realbox: HTMLDivElement | undefined;
	afterEach(() => {
		realbox?.remove();
		realbox = undefined;
		vi.useRealTimers();
	});
	function mountComposer() {
		realbox = document.createElement("div");
		realbox.id = "realbox";
		realbox.innerHTML = '<div class="outerTypeBox"></div>';
		document.body.append(realbox);
	}
	const notice = () => realbox?.querySelector(".sendError")?.textContent ?? null;
	/** A sending channel that is the one on screen. */
	function focusedChannel() {
		const {channel, bubble} = sendingChannel();
		Object.defineProperty(channel, "localuser", {value: {channelfocus: channel}});
		return {channel, bubble};
	}
	const ok = {status: 200, response: {id: "1"}};

	// RED: at HEAD the 429 answers NotOk at once (send 1x, bubble voided).
	it("a rate-limited send waits out the window and sends again", async () => {
		mountComposer();
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: {retry_after: 0.01}}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		// The nonce is minted for real here; stub its revision lookup so it is deterministic
		// (a live lookup would fill the revision cache before the "message nonce" suite runs).
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));

		expect(sent).toHaveLength(2);
		expect(typeof sent[0]).toBe("string");
		// The retry is the same request: a new nonce would let the server post it twice.
		expect(sent[1]).toBe(sent[0]);
		expect(bubble.void).not.toHaveBeenCalled();
		expect(channel.slowmode).not.toHaveBeenCalled();
		expect(notice()).toBeNull();
	});

	// RED: at HEAD the first 429 answers NotOk and shows the notice during what should be the wait.
	it("still refuses when the retry is rate-limited again, and says so only at the end", async () => {
		mountComposer();
		const {XHR, sent} = fakeXHRSequence([
			{status: 429, response: {retry_after: 0.3}},
			{status: 429, response: {message: "You are being rate limited", retry_after: 0.01}},
		]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		await new Promise((res) => setTimeout(res, 100));
		// Inside the server's window: nothing is final yet.
		expect(answers).toEqual([]);
		expect(notice()).toBeNull();

		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));
		expect(sent).toHaveLength(2);
		expect(bubble.void).toHaveBeenCalledTimes(1);
		expect(notice()).toBe("You are being rate limited");
	});

	// PIN: passes at HEAD; the fix must keep a slowmode 429 out of the retry.
	it("a slowmode rate limit is not retried", async () => {
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: {code: 20016, message: "Slowmode"}}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));
		// Room for a wrongly scheduled retry to show up.
		await new Promise((res) => setTimeout(res, 100));

		expect(sent).toHaveLength(1);
		expect(channel.slowmode).toHaveBeenCalledWith(true);
	});

	// RED: at HEAD an unreadable 429 answers NotOk at once, so no second send ever follows.
	it("an unreadable body waits out the 5 s default and retries", async () => {
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: null}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel} = focusedChannel();
		const answers: string[] = [];
		// Only the timers: sendMessage awaits requestAnimationFrame, which must stay real.
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await untilSent(sent, 1);
		await frame();
		await vi.advanceTimersByTimeAsync(4900);
		expect(sent).toHaveLength(1);
		expect(answers).toEqual([]);

		await vi.advanceTimersByTimeAsync(100);
		await untilSent(sent, 2);
		await frame();

		expect(sent).toHaveLength(2);
		expect(answers).toEqual(["Ok"]);
	});

	// RED: at HEAD an attachment send's 429 answers NotOk at once too (the second XHR open).
	it("an attachment send is retried the same way", async () => {
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: {retry_after: 0.01}}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage(
			"hi",
			{nonce: "n1", attachments: [new Blob(["x"], {type: "text/plain"})]},
			(r) => answers.push(r),
		);
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));

		expect(sent).toHaveLength(2);
		expect(sent[0]).toBeInstanceOf(FormData);
		expect(sent[1]).toBeInstanceOf(FormData);
		expect(bubble.void).not.toHaveBeenCalled();
	});

	/** An XMLHttpRequest whose first send answers a 429 and whose second send fails as `how`. */
	function fakeXHRRetryFailing(how: "throws" | "errors") {
		let sends = 0;
		class FakeXHR {
			status = 0;
			response: unknown = null;
			responseType = "";
			upload = {onprogress: null};
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open() {}
			setRequestHeader() {}
			send() {
				sends++;
				if (sends === 1) {
					this.status = 429;
					this.response = {retry_after: 0.01};
					queueMicrotask(() => this.onload?.());
				} else if (how === "throws") {
					throw new Error("offline");
				} else {
					queueMicrotask(() => this.onerror?.());
				}
			}
		}
		return {XHR: FakeXHR, sends: () => sends};
	}

	// RED: at HEAD there is no resend at all: the 429 voids the bubble and `failed` never fires
	// (verified red against HEAD before the fix landed).
	// It also pins the try/catch around the timer's resend: without it the throw escapes the
	// timer and the bubble sits in flight forever.
	it("a retry whose send throws fails the bubble, and never voids it", async () => {
		const {XHR, sends} = fakeXHRRetryFailing("throws");
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		expect(sends()).toBe(2);
		expect(bubble.void).not.toHaveBeenCalled();
		expect(answers).toEqual([]);
	});

	// RED: at HEAD there is no resend at all, so the retry's own network failure never happens
	// (verified red against HEAD before the fix landed).
	// and `failed` is never called.
	it("a retry that fails at the network fails the bubble, and never voids it", async () => {
		const {XHR, sends} = fakeXHRRetryFailing("errors");
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		expect(sends()).toBe(2);
		expect(bubble.void).not.toHaveBeenCalled();
		expect(answers).toEqual([]);
	});
});

describe("the composer's send-error notice", () => {
	let realbox: HTMLDivElement;
	afterEach(() => realbox.remove());
	function mountComposer() {
		realbox = document.createElement("div");
		realbox.id = "realbox";
		realbox.innerHTML = '<div class="outerTypeBox"></div>';
		document.body.append(realbox);
	}
	const notice = () => realbox.querySelector(".sendError")?.textContent ?? null;
	/** A sending channel that is the one on screen. */
	function focusedChannel() {
		const {channel} = sendingChannel();
		const localuser = {channelfocus: channel as unknown};
		Object.defineProperty(channel, "localuser", {value: localuser});
		return channel;
	}
	async function refuse(channel: InstanceType<typeof Channel>, status: number, body: unknown) {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(status, body));
		const answers: string[] = [];
		void channel.sendMessage("hi", {nonce: "n" + Math.random()}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));
	}

	it("shows the server's reason for a refused send, and clears on the next send", async () => {
		mountComposer();
		const channel = focusedChannel();
		await refuse(channel, 403, {code: 50013, message: "Missing Permissions"});
		expect(notice()).toBe("Missing Permissions");

		vi.stubGlobal("XMLHttpRequest", fakeXHR(200, {id: "1"}));
		void channel.sendMessage("again", {nonce: "n2"});
		await vi.waitFor(() => expect(notice()).toBeNull());
	});

	it("says something even when the refusal has no readable reason", async () => {
		mountComposer();
		const channel = focusedChannel();
		await refuse(channel, 500, null);
		expect(notice()).toBeTruthy();
	});

	it("leaves a slowmode refusal to the slowmode countdown", async () => {
		mountComposer();
		const channel = focusedChannel();
		await refuse(channel, 429, {code: 20016, message: "Slowmode"});
		expect(notice()).toBeNull();
	});

	it("isn't shown over another channel's composer when the user has moved on", async () => {
		mountComposer();
		const channel = focusedChannel();
		(channel.localuser as {channelfocus: unknown}).channelfocus = {};
		await refuse(channel, 403, {code: 50013, message: "Missing Permissions"});
		expect(notice()).toBeNull();
		// Nor the slowmode countdown.
		await refuse(channel, 429, {code: 20016, message: "Slowmode"});
		expect(channel.slowmode).not.toHaveBeenCalled();
	});

	it("spells out an invalid-form refusal (a too-long message)", async () => {
		mountComposer();
		const channel = focusedChannel();
		await refuse(channel, 400, {
			code: 50035,
			message: "Invalid Form Body",
			errors: {content: {_errors: [{code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length."}]}},
		});
		expect(notice()).toBe("Must be 2000 or fewer in length.");
	});
});

describe("message nonce", () => {
	// First: the revision is looked up once and cached, so this must run before any success.
	it("is still made when the build-revision lookup fails (offline), and asks again next time", async () => {
		const lookups = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
		vi.stubGlobal("fetch", lookups);

		expect(atob(await createMachloketNonce())).toMatch(/^machloket-unknown\|/);
		await createMachloketNonce();
		expect(lookups).toHaveBeenCalledTimes(2);
	});

	it("two sends in the same second get different nonces (the server dedupes by nonce)", async () => {
		const [a, b] = await Promise.all([createMachloketNonce(), createMachloketNonce()]);

		expect(a).not.toBe(b);
	});
});
