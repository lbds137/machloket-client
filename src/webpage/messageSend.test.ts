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
	for (const [label, response] of [
		["slowmode (a JSON error body)", {code: 20016, message: "Slowmode"}],
		["a body that isn't JSON", null],
	] as const) {
		it(`(${label}) removes its bubble once, with no retry left on a removed bubble`, async () => {
			vi.stubGlobal("XMLHttpRequest", fakeXHR(429, response));
			const {channel, bubble} = sendingChannel();
			const answers: string[] = [];

			void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
			await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));

			expect(bubble.void).toHaveBeenCalledTimes(1);
			expect(bubble.failed).not.toHaveBeenCalled();
		});
	}

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
		const answers: string[] = [];

		void channel.sendMessage("hi", {nonce: "n1"}, (r) => answers.push(r));
		await vi.waitFor(() => expect(answers).toEqual(["NotOk"]));

		expect(channel.slowmode).toHaveBeenCalledWith(true);
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
