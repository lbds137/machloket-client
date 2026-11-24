import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel, createMachloketNonce} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

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

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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
		// Date too: the 429 window is read against the clock, so the fake timers must move it.
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
		try {
			void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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

	it("keeps its bubble as failed when the caller couldn't put the message back", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(403, {code: 50013, message: "Missing Permissions"}));
		const {channel, bubble} = sendingChannel();

		// The composer was busy with a newer message, so the refused one has nowhere else to live.
		void channel.sendMessage("hi", {nonce: "n1"}, () => false);
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		expect(bubble.void).not.toHaveBeenCalled();
	});

	it("keeps its bubble as failed when the caller gave no way to take it back", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(403, {code: 50013, message: "Missing Permissions"}));
		const {channel, bubble} = sendingChannel();

		void channel.sendMessage("hi", {nonce: "n1"});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		expect(bubble.void).not.toHaveBeenCalled();
	});

	it("a poll's bubble says which poll, so a failed one isn't blank, and its question isn't sent as text", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(403, {code: 50013, message: "Missing Permissions"}));
		const send = vi.spyOn(XMLHttpRequest.prototype, "send");
		const {channel, bubble} = sendingChannel();
		const poll = {
			question: {text: "Lunch?"},
			answers: [{poll_media: {text: "Soup"}}],
			duration: 24,
		};

		void channel.sendMessage("", {nonce: "n1", poll});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		const fake = (channel as unknown as {makeFakeMessage: ReturnType<typeof vi.fn>})
			.makeFakeMessage;
		expect(fake.mock.calls[0][0]).toBe("Lunch?");
		expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({content: "", poll});
	});

	it("keeps its bubble as failed, and still settles, when putting the message back throws", async () => {
		vi.stubGlobal("XMLHttpRequest", fakeXHR(403, {code: 50013, message: "Missing Permissions"}));
		const {channel, bubble} = sendingChannel();
		vi.spyOn(console, "error").mockImplementation(() => {});

		const settled = channel.sendMessage("hi", {nonce: "n1"}, () => {
			throw new Error("restore broke");
		});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		await expect(settled).resolves.toBeUndefined();
		expect(bubble.void).not.toHaveBeenCalled();
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

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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

		void channel.sendMessage("hi", {}, (r) => void answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));

		expect(sent).toHaveLength(2);
		expect(typeof sent[0]).toBe("string");
		// The retry is the same request: a new nonce would let the server post it twice.
		expect(sent[1]).toBe(sent[0]);
		expect(bubble.void).not.toHaveBeenCalled();
		expect(channel.slowmode).not.toHaveBeenCalled();
		expect(notice()).toBeNull();
	});

	// RED (A1, pre-fix): the resend's delay is snapshotted at the 429, so a longer window armed
	// on the same POST bucket afterwards is not waited out; the resend goes at the first end.
	it("a resend waits out a longer window armed after its 429 (the delay isn't snapshotted)", async () => {
		mountComposer();
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: {retry_after: 0.1}}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel} = focusedChannel();
		const url = "http://send.test/api/v9/channels/" + channel.id + "/messages";
		const {armRateLimit, rateLimitRemaining} = await import("./utils/rateLimitWindows");
		const answers: string[] = [];

		void channel.sendMessage("hi", {}, (r) => void answers.push(r));
		await vi.waitFor(() => expect(rateLimitRemaining(url, "POST")).toBeGreaterThan(0), {
			interval: 5,
		});
		armRateLimit(url, {retry_after: 0.4}, "POST");
		await new Promise((r) => setTimeout(r, 300)); // past the first window's 0.1 s end

		expect(sent).toHaveLength(1);
		await vi.waitFor(() => expect(sent).toHaveLength(2), {timeout: 1500});
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));
	});

	// RED (pre-change): the module is missing at HEAD, so this row fails at its import, not at an
	// assertion. The send path must arm the window its send URL shares, so the wait is visible.
	it("a send's 429 arms the window on its send URL", async () => {
		mountComposer();
		const {XHR} = fakeXHRSequence([{status: 429, response: {retry_after: 0.5}}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel} = focusedChannel();
		const answers: string[] = [];
		const {rateLimitRemaining} = await import("./utils/rateLimitWindows");

		void channel.sendMessage("hi", {}, (r) => void answers.push(r));

		await vi.waitFor(
			() =>
				expect(
					rateLimitRemaining(
						"http://send.test/api/v9/channels/" + channel.id + "/messages",
						"POST",
					),
				).toBeGreaterThan(0),
			{interval: 5},
		);
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));
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

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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
		const {XHR, sent} = fakeXHRSequence([
			{status: 429, response: {code: 20016, message: "Slowmode"}},
			ok,
		]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));
		// Room for a wrongly scheduled retry to show up.
		await new Promise((res) => setTimeout(res, 100));

		expect(sent).toHaveLength(1);
		expect(channel.slowmode).toHaveBeenCalledWith(true);
	});

	/** An XMLHttpRequest whose answers the test gives by hand: each send waits in `pending` until
	 * answered, unless `autoOk` is set, which answers every later send with 200. `sent` holds
	 * each send's message content, in the order they reached the wire. `throwOnSend` lists the
	 * 0-based send indices whose `send()` throws before recording or answering (every call counts,
	 * the throwing ones included). An attachment send's content is read from its `payload_json`,
	 * and a FormData body whose `payload_json` is missing or not a string throws a named error. */
	function fakeXHRByHand() {
		const sent: string[] = [];
		const pending: ((status: number, response: unknown) => void)[] = [];
		const state = {autoOk: false, throwOnSend: [] as number[]};
		let sendCount = 0;
		class FakeXHR {
			status = 0;
			response: unknown = null;
			responseType = "";
			upload = {onprogress: null};
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open() {}
			setRequestHeader() {}
			send(body: string | FormData) {
				const index = sendCount++;
				if (state.throwOnSend.includes(index)) throw new Error("send failed");
				let payload: string;
				if (body instanceof FormData) {
					const raw = body.get("payload_json");
					if (typeof raw !== "string") {
						throw new Error(
							"fakeXHRByHand: FormData body's payload_json is missing or not a string",
						);
					}
					payload = raw;
				} else {
					payload = body;
				}
				sent.push((JSON.parse(payload) as {content: string}).content);
				const answer = (status: number, response: unknown) => {
					this.status = status;
					this.response = response;
					queueMicrotask(() => this.onload?.());
				};
				if (state.autoOk) answer(200, {id: "1"});
				else pending.push(answer);
			}
		}
		return {XHR: FakeXHR, sent, pending, state};
	}

	// RED (TASK-93): at HEAD the 429'd send re-enters its bucket's queue at the back, so a later
	// send already waiting on the window goes out first: the wire reads A, B, A.
	it("a 429'd send's resend goes out before a later send already waiting on the window", async () => {
		const {XHR, sent, pending, state} = fakeXHRByHand();
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel} = focusedChannel();
		Object.defineProperty(channel, "id", {value: "293"});
		const url = "http://send.test/api/v9/channels/293/messages";
		const {armRateLimit, rateLimitWaiterCountForTests} = await import("./utils/rateLimitWindows");
		const answers: string[] = [];

		void channel.sendMessage("A", {}, (r) => void answers.push("A " + r));
		await untilSent(sent, 1);
		// Another request's 429 arms the bucket while A is on the wire; B queues on it.
		armRateLimit(url, {retry_after: 0.15}, "POST");
		void channel.sendMessage("B", {}, (r) => void answers.push("B " + r));
		await vi.waitFor(() => expect(rateLimitWaiterCountForTests(url, "POST")).toBe(1)); // B is parked
		expect(sent).toEqual(["A"]);
		state.autoOk = true;
		pending[0](429, {retry_after: 0.05});

		await vi.waitFor(() => expect(answers).toHaveLength(2), {timeout: 1500});
		expect(sent).toEqual(["A", "A", "B"]);
	});

	// RED (TASK-93): at HEAD the failed bubble's retry button re-sends at once, inside the window.
	it("a failed bubble's retry waits out the bucket's window before it sends", async () => {
		const {XHR, sent, pending, state} = fakeXHRByHand();
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel, bubble} = focusedChannel();
		Object.defineProperty(channel, "id", {value: "294"});
		const url = "http://send.test/api/v9/channels/294/messages";
		const {armRateLimit} = await import("./utils/rateLimitWindows");

		void channel.sendMessage("A", {}, () => false);
		await untilSent(sent, 1);
		pending[0](500, {message: "boom"});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));
		const retry = bubble.failed.mock.calls[0][0] as () => void;
		armRateLimit(url, {retry_after: 0.15}, "POST");
		state.autoOk = true;

		retry();
		await new Promise((r) => setTimeout(r, 50)); // inside the window
		expect(sent).toEqual(["A"]);
		await vi.waitFor(() => expect(sent).toEqual(["A", "A"]), {timeout: 1500});
	});

	// RED (TASK-93): at HEAD the send's one resend is spent by its first 429, so a retry by hand
	// that draws a 429 fails the bubble again at once instead of waiting and re-sending.
	it("a failed bubble's retry gets its own resend after a 429", async () => {
		const {XHR, sent, pending, state} = fakeXHRByHand();
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel, bubble} = focusedChannel();
		Object.defineProperty(channel, "id", {value: "295"});
		const answers: string[] = [];

		void channel.sendMessage("A", {}, (r) => {
			answers.push(r);
			return false;
		});
		await untilSent(sent, 1);
		pending[0](429, {retry_after: 0.01});
		await untilSent(sent, 2);
		pending[1](429, {retry_after: 0.01});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));
		(bubble.failed.mock.calls[0][0] as () => void)();
		await untilSent(sent, 3);
		state.autoOk = true;
		pending[2](429, {retry_after: 0.01});

		await vi.waitFor(() => expect(answers).toEqual(["NotOk", "Ok"]), {timeout: 1500});
		expect(sent).toEqual(["A", "A", "A", "A"]);
		expect(bubble.failed).toHaveBeenCalledTimes(1);
	});

	it("an attachment send's 429'd resend goes out before a later send already waiting on the window", async () => {
		const {XHR, sent, pending, state} = fakeXHRByHand();
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel} = focusedChannel();
		Object.defineProperty(channel, "id", {value: "296"});
		const url = "http://send.test/api/v9/channels/296/messages";
		const {armRateLimit, rateLimitWaiterCountForTests} = await import("./utils/rateLimitWindows");
		const answers: string[] = [];

		void channel.sendMessage(
			"A",
			{attachments: [new File(["x"], "a.txt", {type: "text/plain"})]},
			(r) => void answers.push("A " + r),
		);
		await untilSent(sent, 1);
		// Another request's 429 arms the bucket while A is on the wire; B queues on it.
		armRateLimit(url, {retry_after: 0.15}, "POST");
		void channel.sendMessage("B", {}, (r) => void answers.push("B " + r));
		await vi.waitFor(() => expect(rateLimitWaiterCountForTests(url, "POST")).toBe(1)); // B is parked
		expect(sent).toEqual(["A"]);
		state.autoOk = true;
		pending[0](429, {retry_after: 0.05});

		await vi.waitFor(() => expect(answers).toHaveLength(2), {timeout: 1500});
		expect(sent).toEqual(["A", "A", "B"]);
	});

	// A retry's resend that throws (the send itself, not a 429) fails the bubble again, so its retry
	// button stays usable.
	it("a retry whose resend throws fails the bubble again, and its retry works", async () => {
		const {XHR, sent, pending, state} = fakeXHRByHand();
		vi.stubGlobal("XMLHttpRequest", XHR);
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
		const {channel, bubble} = focusedChannel();
		Object.defineProperty(channel, "id", {value: "297"});
		const answers: string[] = [];

		void channel.sendMessage("A", {}, (r) => {
			answers.push(r);
			return false;
		});
		await untilSent(sent, 1);
		pending[0](500, {message: "boom"});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));
		state.throwOnSend = [1];
		state.autoOk = true;
		(bubble.failed.mock.calls[0][0] as () => void)();

		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(2));
		(bubble.failed.mock.calls[1][0] as () => void)();

		await vi.waitFor(() => expect(answers.at(-1)).toBe("Ok"), {timeout: 1500});
		expect(sent).toEqual(["A", "A"]);
	});

	// Both sends park on a window armed before either goes out: the line is ticket-sorted, so A
	// leaves first only if its first wait carries the ticket A took when it started. B takes the
	// other branch, so a branch that dropped the ticket would hand only A a later one.
	it.each([
		["an attachment", "298", true],
		["a text", "299", false],
	])(
		"%s send waiting on a window goes out before a later send waiting on it",
		async (_, id, withFile) => {
			const {XHR, sent, state} = fakeXHRByHand();
			vi.stubGlobal("XMLHttpRequest", XHR);
			vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
			const {channel} = focusedChannel();
			Object.defineProperty(channel, "id", {value: id});
			const {armRateLimit} = await import("./utils/rateLimitWindows");
			armRateLimit(`http://send.test/api/v9/channels/${id}/messages`, {retry_after: 0.15}, "POST");
			state.autoOk = true;
			const answers: string[] = [];

			const file = [new File(["x"], "a.txt", {type: "text/plain"})];
			const [aFiles, bFiles] = withFile ? [file, []] : [[], file];
			void channel.sendMessage("A", {attachments: aFiles}, (r) => void answers.push("A " + r));
			void channel.sendMessage("B", {attachments: bFiles}, (r) => void answers.push("B " + r));

			await vi.waitFor(() => expect(answers).toHaveLength(2), {timeout: 1500});
			expect(sent).toEqual(["A", "B"]);
		},
	);

	// RED: at HEAD an unreadable 429 answers NotOk at once, so no second send ever follows.
	it("an unreadable body waits out the 5 s default and retries", async () => {
		const {XHR, sent} = fakeXHRSequence([{status: 429, response: null}, ok]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel} = focusedChannel();
		const answers: string[] = [];
		// Only the timers: sendMessage awaits requestAnimationFrame, which must stay real.
		// Date too: the 429 window is read against the clock, so the fake timers must move it.
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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
			(r) => void answers.push(r),
		);
		await vi.waitFor(() => expect(answers).toEqual(["Ok"]));

		expect(sent).toHaveLength(2);
		expect(sent[0]).toBeInstanceOf(FormData);
		expect(sent[1]).toBeInstanceOf(FormData);
		expect(bubble.void).not.toHaveBeenCalled();
	});

	// RED: verified against this PR's pre-fix tree — resend re-capped the attachment XHR at
	// 30 s (its timeout line) with no ontimeout wired, so a resent upload that hit the cap
	// hung the bubble forever.
	it("an attachment retry stays untimed, and a timeout on it fails the bubble instead of hanging", async () => {
		const sentConfig: {timeout: number; timed: boolean}[] = [];
		class FakeXHR {
			status = 0;
			response: unknown = null;
			responseType = "";
			timeout = 0;
			upload = {onprogress: null};
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			ontimeout: (() => void) | null = null;
			open() {}
			setRequestHeader() {}
			send() {
				sentConfig.push({timeout: this.timeout, timed: typeof this.ontimeout === "function"});
				if (sentConfig.length === 1) {
					this.status = 429;
					this.response = {retry_after: 0.01};
					queueMicrotask(() => this.onload?.());
					return;
				}
				// The resent upload hits a (should-be-none) timeout: fail the bubble, never hang.
				queueMicrotask(() => this.ontimeout?.());
			}
		}
		vi.stubGlobal("XMLHttpRequest", FakeXHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage(
			"hi",
			{nonce: "n1", attachments: [new Blob(["x"], {type: "text/plain"})]},
			(r) => void answers.push(r),
		);
		await vi.waitFor(() => expect(sentConfig).toHaveLength(2));

		// Both sends are untimed, and both carry the timeout handler.
		expect(sentConfig[0]).toEqual({timeout: 0, timed: true});
		expect(sentConfig[1]).toEqual({timeout: 0, timed: true});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));
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

	// RED: verified against this PR's pre-fix tree — without the fix there is no resend at
	// all: the 429 voids the bubble and `failed` never fires.
	// It also pins the try/catch around the timer's resend: without it the throw escapes the
	// timer and the bubble sits in flight forever.
	it("a retry whose send throws fails the bubble, and never voids it", async () => {
		const {XHR, sends} = fakeXHRRetryFailing("throws");
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));

		expect(sends()).toBe(2);
		expect(bubble.void).not.toHaveBeenCalled();
		expect(answers).toEqual([]);
	});

	// RED: verified against this PR's pre-fix tree — without the fix there is no resend, so
	// the retry's own network failure never happens, and `failed` is never called.
	it("a retry that fails at the network fails the bubble, and never voids it", async () => {
		const {XHR, sends} = fakeXHRRetryFailing("errors");
		vi.stubGlobal("XMLHttpRequest", XHR);
		const {channel, bubble} = focusedChannel();
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => void answers.push(r));
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
		void channel.sendMessage("hi", {nonce: "n" + Math.random()}, (r) => void answers.push(r));
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
			errors: {
				content: {
					_errors: [{code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length."}],
				},
			},
		});
		expect(notice()).toBe("Must be 2000 or fewer in length.");
	});
});

describe("a message over the instance's limit", () => {
	let realbox: HTMLDivElement;
	afterEach(() => realbox.remove());
	const notice = () => realbox.querySelector(".sendError")?.textContent ?? null;
	/** The channel on screen, on an instance limiting messages to `limit`. */
	function onScreen(limit: number | undefined) {
		realbox = document.createElement("div");
		realbox.id = "realbox";
		document.body.append(realbox);
		const {channel, bubble} = sendingChannel();
		Object.defineProperty(channel, "localuser", {
			value: {channelfocus: channel, messageLimit: limit},
			configurable: true,
		});
		Object.defineProperty(channel, "guild", {
			value: {id: "1", members: new Set([{id: "123456789", user: {username: "nyx"}}])},
		});
		const {XHR, sent} = fakeXHRSequence([{status: 200, response: {id: "1"}}]);
		vi.stubGlobal("XMLHttpRequest", XHR);
		return {channel, bubble, sent};
	}
	/** Sends and returns what the composer was told. */
	async function send(channel: InstanceType<typeof Channel>, content: string) {
		const answers: string[] = [];
		void channel.sendMessage(content, {nonce: "n" + Math.random()}, (r) => void answers.push(r));
		await vi.waitFor(() => expect(answers.length).toBe(1));
		return answers;
	}

	it("isn't sent, draws no bubble, and tells the composer to take it back", async () => {
		const {channel, sent} = onScreen(5);

		expect(await send(channel, "x".repeat(6))).toEqual(["NotOk"]);

		expect(sent).toEqual([]);
		expect(
			(channel as unknown as {makeFakeMessage: unknown}).makeFakeMessage,
		).not.toHaveBeenCalled();
		expect(notice()).toBe(I18n.channel.tooLong("6", "5"));
	});

	it("goes out at exactly the limit", async () => {
		const {channel, sent} = onScreen(5);

		expect(await send(channel, "x".repeat(5))).toEqual(["Ok"]);

		expect(sent.length).toBe(1);
		expect(notice()).toBeNull();
	});

	it("counts what goes on the wire: a typed mention grows into its id", async () => {
		const {channel, sent} = onScreen(5);

		expect(await send(channel, "@nyx")).toEqual(["NotOk"]);

		expect(sent).toEqual([]);
		expect(notice()).toBe(I18n.channel.tooLong("12", "5"));
	});

	it("counts as the server does: an emoji is 2, and space it would trim still counts", async () => {
		const emoji = onScreen(5);
		expect(await send(emoji.channel, "😀😀😀")).toEqual(["NotOk"]);
		expect(emoji.sent).toEqual([]);
		realbox.remove();

		const spaces = onScreen(5);
		expect(await send(spaces.channel, "x     ")).toEqual(["NotOk"]);
		expect(spaces.sent).toEqual([]);
	});

	it("is the server's call when the limit isn't known", async () => {
		const {channel, sent} = onScreen(undefined);

		expect(await send(channel, "x".repeat(6000))).toEqual(["Ok"]);

		expect(sent.length).toBe(1);
	});

	it.each([
		["couldn't put the text back", () => false],
		[
			"threw putting it back",
			(res: "Ok" | "NotOk") => {
				if (res === "NotOk") throw new Error("no composer");
			},
		],
	])(
		"goes to the server when the composer %s, so the failed bubble keeps it",
		async (_name, onRes) => {
			const {channel, sent} = onScreen(5);

			void channel.sendMessage("x".repeat(6), {nonce: "n" + Math.random()}, onRes);
			await vi.waitFor(() => expect(sent.length).toBe(1));

			expect(notice()).toBeNull();
		},
	);

	it("goes to the server when the caller gave no way to take it back", async () => {
		const {channel, sent} = onScreen(5);

		void channel.sendMessage("x".repeat(6), {nonce: "n" + Math.random()});
		await vi.waitFor(() => expect(sent.length).toBe(1));

		expect(notice()).toBeNull();
	});

	it("says nothing under a channel the user has left", async () => {
		const {channel, sent} = onScreen(5);
		Object.defineProperty(channel, "localuser", {value: {channelfocus: null, messageLimit: 5}});

		expect(await send(channel, "x".repeat(6))).toEqual(["NotOk"]);

		expect(sent).toEqual([]);
		expect(notice()).toBeNull();
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
