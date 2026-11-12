import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");

/** A user mid-session: READY gave it a session to resume. The close path abandons member
 * lookups (their maps) and the fast-resume .then runs loaduser; neither is under test here. */
function sessionUser() {
	const user = gatewayUser();
	user.session_id = "sess-1";
	user.resume_gateway_url = "wss://resume.test";
	user.lastSequence = 41;
	Object.assign(user, {
		loaduser: () => {},
		unload: vi.fn(),
		fetchingmembers: new Map(),
		memberLookupDrops: new Map(),
		noncemap: new Map(),
		noncebuild: new Map(),
		waitingmembers: new Map(),
	});
	return user;
}

/** Answers the socket's RESUME the way Spacebar does once it has replayed what was missed. */
async function resumeOn(ws: InstanceType<typeof FakeWebSocket>) {
	ws.emit("open", {});
	ws.emit("message", {data: JSON.stringify({op: 0, t: "RESUMED", s: 42, d: {}})});
	await vi.advanceTimersByTimeAsync(0);
}

/** Drops a resumed socket with the server's own close code, so the fast-resume path builds
 * the replacement. */
async function dropForResume(ws: InstanceType<typeof FakeWebSocket>) {
	ws.emit("close", {code: 1000});
	await vi.advanceTimersByTimeAsync(0);
	expect(FakeWebSocket.sockets).toHaveLength(2);
	return FakeWebSocket.sockets[1];
}

describe("gateway socket identity", () => {
	beforeEach(() => {
		FakeWebSocket.sockets = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("a stale op 7 from the dropped socket does not close the resumed one", async () => {
		const user = sessionUser();
		// Hold op 7's handling open until the replacement socket exists: the interleaving a
		// half-closed socket really produces, its last frame landing after the fast resume.
		const gate = Promise.withResolvers<void>();
		const real = user.handleEvent.bind(user);
		// The mock's args come through untyped (gatewayUser is a prototype build): ws is the
		// socket the frame arrived on, absent entirely before the identity fix.
		vi.spyOn(user, "handleEvent").mockImplementation(async (temp: any, ws?: any) => {
			if (temp.op === 7) await gate.promise;
			await real(temp, ws);
		});
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		await resumeOn(A);

		A.emit("message", {data: JSON.stringify({op: 7, d: null})});
		A.emit("close", {code: 1000});
		await vi.advanceTimersByTimeAsync(0);
		// Socket B exists while A's op 7 is still suspended at the gate.
		expect(FakeWebSocket.sockets).toHaveLength(2);
		const B = FakeWebSocket.sockets[1];

		gate.resolve();
		await vi.advanceTimersByTimeAsync(0);

		expect(B.closed).toBeUndefined();
		expect(user.ws).toBe(B);
	});

	it("a stale op 9 forgets nothing — the live socket keeps its session", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		await resumeOn(A);
		const B = await dropForResume(A);

		A.emit("message", {data: JSON.stringify({op: 9, d: false})});
		await vi.advanceTimersByTimeAsync(0);

		expect(user.session_id).toBe("sess-1");
		expect(B.closed).toBeUndefined();
	});

	it("a stale op 10 does not re-arm its timers on the new socket", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		await resumeOn(A);
		const B = await dropForResume(A);
		B.emit("open", {});
		await vi.advanceTimersByTimeAsync(0);

		A.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);

		expect(B.sent.filter((m) => m.op === 1 || m.op === 40)).toHaveLength(0);
		expect(user.heartbeatTimer).toBeUndefined();
	});

	it("a stale op 11 does not mark the connection good", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		await resumeOn(A);
		await dropForResume(A);

		A.emit("message", {data: JSON.stringify({op: 11, d: {}})});
		await vi.advanceTimersByTimeAsync(0);

		expect(user.connectionSucceed).toBe(0);
	});

	it("op 7 on the current socket still closes it with 4000", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		await resumeOn(A);

		A.emit("message", {data: JSON.stringify({op: 7, d: null})});
		await vi.advanceTimersByTimeAsync(0);

		expect(A.closed).toBe(4000);
	});
});
