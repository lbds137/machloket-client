import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

const API = "http://typing.test/api/v9";
const limited = () => Response.json({message: "rate limited", retry_after: 0.001}, {status: 429});

function typingChannel() {
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: {info: {api: API}},
		headers: {},
	}) as InstanceType<typeof Channel>;
}

let unhandled: string[] = [];
const onUnhandled = (e: PromiseRejectionEvent) => {
	unhandled.push(String(e.reason));
	e.preventDefault();
};
beforeEach(() => {
	unhandled = [];
	window.addEventListener("unhandledrejection", onUnhandled);
});
afterEach(() => window.removeEventListener("unhandledrejection", onUnhandled));

describe("the typing indicator", () => {
	// RED: at HEAD the 429 is dropped, so the POST count stays 1.
	it("a 429 waits its window and posts again once", async () => {
		let calls = 0;
		const posted = captureRequests(API + "/channels/c1/typing", () =>
			calls++ === 0 ? limited() : new Response(null, {status: 204}),
		);

		typingChannel().typingstart();

		await vi.waitFor(() => expect(posted).toHaveLength(2));
		expect(unhandled).toEqual([]);
	});

	// PIN: passes at HEAD (no retry exists there to cancel). Guards the fix's staleness
	// gate: a wrongly-armed retry would take the POST count to 2 after the window dies.
	it("a 429 whose wait outlives the typing window is not retried", async () => {
		const posted = captureRequests(API + "/channels/c1/typing", () =>
			Response.json({message: "rate limited", retry_after: 0.3}, {status: 429}),
		);
		const channel = typingChannel();

		channel.typingstart();
		// The 6 s window, shrunk so it is alive when the 429 lands (a few ms) and dead when
		// the 0.3 s wait ends.
		channel.typing = Date.now() + 100;
		await new Promise((res) => setTimeout(res, 600));

		expect(posted).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});

	// RED: at HEAD the rejected fetch floats as an unhandled rejection (the tracker's earlier
	// `toEqual([])` could not see one: nothing there ever rejected).
	it("a typing request that fails at the network leaves no unhandled rejection", async () => {
		const posted = captureRequests(API + "/channels/c1/typing", () =>
			Promise.reject(new TypeError("offline")),
		);

		typingChannel().typingstart();
		// Room for the rejection to be reported.
		await new Promise((res) => setTimeout(res, 100));

		expect(posted).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});

	// PIN: passes at HEAD; the client-side 6 s throttle still gates the first fetch.
	it("a second keystroke inside the throttle window posts nothing", async () => {
		const posted = captureRequests(API + "/channels/c1/typing");
		const channel = typingChannel();

		channel.typingstart();
		channel.typingstart();
		// Room for a wrongly unthrottled second POST to show up.
		await new Promise((res) => setTimeout(res, 100));

		expect(posted).toHaveLength(1);
	});
});
