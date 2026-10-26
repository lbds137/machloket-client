import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Channel} = await import("./channel");
const {Guild} = await import("./guild");

const API = "http://ack.test/api/v9";
const limited = () => Response.json({message: "rate limited", retry_after: 0.001}, {status: 429});

/** Answers the first call with a 429 and every later one with a 204. */
function limitedOnce() {
	let calls = 0;
	return () => (calls++ === 0 ? limited() : new Response(null, {status: 204}));
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

describe("marking a channel read", () => {
	// RED: at HEAD the 429 is dropped, so the ack count stays 1.
	it("from the inbox: a 429 waits its window and acks again once", async () => {
		const acked = captureRequests(API + "/channels/c1/messages/m5/ack", limitedOnce());
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {},
		}) as unknown as {markChannelRead(channel: object): void};
		const channel = {
			id: "c1",
			hasunreads: true,
			mentions: 0,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			guild: {unreads: () => {}},
			unreads: () => {},
		};

		localuser.markChannelRead(channel);

		await vi.waitFor(() => expect(acked).toHaveLength(2));
		expect(unhandled).toEqual([]);
	});

	// RED: at HEAD the 429 is dropped, so the ack count stays 1.
	it("on reaching the bottom of a channel: a 429 waits its window and acks again once", async () => {
		const acked = captureRequests(API + "/channels/c1/messages/m5/ack", limitedOnce());
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}, unreads: () => {}, localuser: {}},
			headers: {},
			// Unread through its mentions, which skips the permission and read-state lookups.
			hasPermission: () => true,
			mentions: 1,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			unreads: () => {},
			infinite: {toBottom: () => {}},
		}) as InstanceType<typeof Channel>;

		channel.readbottom();

		await vi.waitFor(() => expect(acked).toHaveLength(2));
		expect(unhandled).toEqual([]);
	});
});

describe("marking a whole server read", () => {
	// RED: at HEAD the 429 is dropped, so the bulk-ack count stays 1.
	it("a 429 waits its window and acks in bulk again once", async () => {
		const acked = captureRequests(API + "/read-states/ack-bulk", limitedOnce());
		const guild = Object.assign(Object.create(Guild.prototype), {
			owner: {info: {api: API}},
			headers: {},
			channels: [{id: "c1", hasunreads: true, trueLastMessageid: "m5"}],
			unreads: () => {},
		}) as InstanceType<typeof Guild>;

		await guild.markAsRead();

		await vi.waitFor(() => expect(acked).toHaveLength(2));
		expect(acked[1]).toEqual(acked[0]);
		expect(unhandled).toEqual([]);
	});
});

// An ack is bookkeeping nothing reacts to, so a network failure must not float as an unhandled
// rejection. The fixtures above only ever answered, so their `unhandled` checks could not see one.
describe("an ack that fails at the network", () => {
	const offline = () => Promise.reject(new TypeError("offline"));
	// Room for a floated rejection to be reported.
	const settle = () => new Promise((res) => setTimeout(res, 100));

	// RED: at HEAD the rejection floats out of the un-awaited ack.
	it("from the inbox leaves no unhandled rejection", async () => {
		const acked = captureRequests(API + "/channels/c1/messages/m5/ack", offline);
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {},
		}) as unknown as {markChannelRead(channel: object): void};
		const channel = {
			id: "c1",
			hasunreads: true,
			mentions: 0,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			guild: {unreads: () => {}},
			unreads: () => {},
		};

		localuser.markChannelRead(channel);
		await settle();

		expect(acked).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});

	// RED: at HEAD the rejection floats out of the un-awaited ack.
	it("on reaching the bottom of a channel leaves no unhandled rejection", async () => {
		const acked = captureRequests(API + "/channels/c1/messages/m5/ack", offline);
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}, unreads: () => {}, localuser: {}},
			headers: {},
			hasPermission: () => true,
			mentions: 1,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			unreads: () => {},
			infinite: {toBottom: () => {}},
		}) as InstanceType<typeof Channel>;

		channel.readbottom();
		await settle();

		expect(acked).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});

	// RED: at HEAD the rejection floats out of the un-awaited bulk ack.
	it("for a whole server leaves no unhandled rejection", async () => {
		const acked = captureRequests(API + "/read-states/ack-bulk", offline);
		const guild = Object.assign(Object.create(Guild.prototype), {
			owner: {info: {api: API}},
			headers: {},
			channels: [{id: "c1", hasunreads: true, trueLastMessageid: "m5"}],
			unreads: () => {},
		}) as InstanceType<typeof Guild>;

		await guild.markAsRead();
		await settle();

		expect(acked).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});
});

// A retried ack would move the server's read state back to the older message: the staleness
// guards in markChannelRead and markAsRead must cancel the retry once a newer read lands.
describe("a newer read during an ack's 429 window", () => {
	// `limited`'s 0.001 s window closes before the test can read on; 0.3 s is one it can outwait,
	// like the read-ack test in rateLimit.test.ts.
	const windowOnce = () => {
		let calls = 0;
		return () =>
			calls++ === 0
				? Response.json({message: "rate limited", retry_after: 0.3}, {status: 429})
				: new Response(null, {status: 204});
	};
	// Long enough that a 0.3 s window's retry has gone out if the guard were gone.
	const outwait = () => new Promise((res) => setTimeout(res, 500));

	it("from the inbox: a newer ack outliving the 429 window stops the stale retry", async () => {
		const acked: string[] = [];
		let first = true;
		for (const id of ["m5", "m9"]) {
			captureRequests(API + `/channels/c1/messages/${id}/ack`, () => {
				acked.push(id);
				if (first) {
					first = false;
					return Response.json({message: "rate limited", retry_after: 0.3}, {status: 429});
				}
				return new Response(null, {status: 204});
			});
		}
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {},
		}) as unknown as {markChannelRead(channel: object): void};
		const channel = {
			id: "c1",
			hasunreads: true,
			mentions: 0,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			guild: {unreads: () => {}},
			unreads: () => {},
		};

		localuser.markChannelRead(channel);
		await vi.waitFor(() => expect(acked).toEqual(["m5"]));
		// The user reads on: a newer ack goes out while m5's retry waits.
		channel.trueLastMessageid = "m9";
		localuser.markChannelRead(channel);
		await outwait();

		// m5 again would move the server's read state back to m5.
		expect(acked).toEqual(["m5", "m9"]);
		expect(unhandled).toEqual([]);
	});

	it("from the inbox: a new message alone does not stop the stale retry", async () => {
		// Discriminates the guard's field: only a newer READ cancels the retry. If the guard
		// regressed onto trueLastMessageid, mere incoming traffic would cancel legitimate acks.
		const acked = captureRequests(API + "/channels/c1/messages/m5/ack", windowOnce());
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {},
		}) as unknown as {markChannelRead(channel: object): void};
		const channel = {
			id: "c1",
			hasunreads: true,
			mentions: 0,
			trueLastMessageid: "m5",
			messages: new Map(),
			idToNext: new Map(),
			guild: {unreads: () => {}},
			unreads: () => {},
		};

		localuser.markChannelRead(channel);
		await vi.waitFor(() => expect(acked).toHaveLength(1));
		// A message arrives; nobody reads. The retry must still go out.
		channel.trueLastMessageid = "m9";
		await outwait();

		expect(acked).toHaveLength(2);
		expect(unhandled).toEqual([]);
	});

	it("for a whole server: a newer ack outliving the 429 window stops the stale retry", async () => {
		const acked = captureRequests(API + "/read-states/ack-bulk", windowOnce());
		const guild = Object.assign(Object.create(Guild.prototype), {
			owner: {info: {api: API}},
			headers: {},
			channels: [
				{id: "c1", hasunreads: true, trueLastMessageid: "m5"},
				{id: "c2", hasunreads: true, trueLastMessageid: "m7"},
			],
			unreads: () => {},
		}) as InstanceType<typeof Guild>;

		await guild.markAsRead();
		// c1 reads further while the bulk retry waits: exactly the state the guard watches.
		guild.channels[0].lastreadmessageid = "m9";
		await outwait();

		// Retrying would move c1 back to m5, so the bulk ack must not go out again.
		expect(acked).toHaveLength(1);
		expect(unhandled).toEqual([]);
	});
});
