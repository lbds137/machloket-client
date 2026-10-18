import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");

beforeEach(() => {
	FakeWebSocket.sockets = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/** Answers the socket's RESUME the way Spacebar does once it has replayed what was missed. */
async function resumeOn(ws: InstanceType<typeof FakeWebSocket>) {
	ws.emit("open", {});
	ws.emit("message", {data: JSON.stringify({op: 0, t: "RESUMED", s: 42, d: {}})});
	await vi.advanceTimersByTimeAsync(0);
}

it("a guild's member lookup that keeps ending the connection is given up, not asked forever", async () => {
	const user = gatewayUser();
	const waiter = vi.fn();
	Object.assign(user, {
		session_id: "sess-1",
		resume_gateway_url: "wss://resume.test",
		lastSequence: 41,
		fetchingmembers: new Map(),
		memberLookupDrops: new Map(),
		noncemap: new Map(),
		noncebuild: new Map(),
		waitingmembers: new Map([["g1", new Map([["u1", waiter]])]]),
		loaduser: () => {},
	});
	user.initwebsocket(true);
	await resumeOn(FakeWebSocket.sockets[0]);
	user.getmembers();
	await vi.advanceTimersByTimeAsync(20);

	// The server answers that lookup by closing the socket (4000), every time it's asked.
	for (let round = 0; round < 4; round++) {
		const ws = FakeWebSocket.sockets.at(-1)!;
		if (!ws.sent.some((m) => m.op === 8)) break;
		ws.emit("close", {code: 4000});
		await vi.advanceTimersByTimeAsync(20);
		const next = FakeWebSocket.sockets.at(-1)!;
		if (next === ws) break;
		await resumeOn(next);
		// Each resume would reset the backoff; the client must stop re-asking on its own.
		user.errorBackoff = 0;
		await vi.advanceTimersByTimeAsync(20);
	}

	const lookups = FakeWebSocket.sockets.flatMap((ws) => ws.sent.filter((m) => m.op === 8));
	expect(lookups.length).toBeLessThanOrEqual(2);
	expect(waiter).toHaveBeenCalledWith(undefined);
	expect(user.waitingmembers.has("g1")).toBe(false);
});

it("drops that aren't in a row don't give a guild's lookups up", () => {
	const user = gatewayUser();
	const waiter = vi.fn();
	Object.assign(user, {
		fetchingmembers: new Map([["g1", true]]),
		memberLookupDrops: new Map(),
		noncemap: new Map(),
		noncebuild: new Map(),
		waitingmembers: new Map([["g1", new Map([["u1", waiter]])]]),
	});

	user.abandonMemberRequests(); // g1 in flight: one drop
	user.abandonMemberRequests(); // nothing in flight: the run is broken
	user.fetchingmembers.set("g1", true);
	user.abandonMemberRequests(); // g1 in flight again: one drop, not two

	expect(waiter).not.toHaveBeenCalled();
	expect(user.waitingmembers.has("g1")).toBe(true);
});

it("a deleted guild's queued member lookups settle as no member", () => {
	const user = gatewayUser();
	const waiter = vi.fn();
	Object.assign(user, {
		memberLookupDrops: new Map(),
		waitingmembers: new Map([["g1", new Map([["u1", waiter]])]]),
	});

	user.giveUpMemberLookups("g1");

	expect(waiter).toHaveBeenCalledWith(undefined);
	expect(user.waitingmembers.has("g1")).toBe(false);
});
