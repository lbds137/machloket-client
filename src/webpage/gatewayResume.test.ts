import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");

/** A user mid-session: READY gave it a session to resume. */
function sessionUser() {
	const user = gatewayUser();
	user.session_id = "sess-1";
	user.resume_gateway_url = "wss://resume.test";
	user.lastSequence = 41;
	return user;
}

/** Answers the socket's RESUME the way Spacebar does once it has replayed what was missed. */
async function resumeOn(ws: InstanceType<typeof FakeWebSocket>) {
	ws.emit("open", {});
	ws.emit("message", {data: JSON.stringify({op: 0, t: "RESUMED", s: 42, d: {}})});
	await vi.advanceTimersByTimeAsync(0);
}

describe("gateway resume", () => {
	beforeEach(() => {
		FakeWebSocket.sockets = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("a resumed session can resume again on the next drop", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const ws = FakeWebSocket.sockets[0];
		await resumeOn(ws);

		expect(ws.sent.find((m) => m.op === 6)).toMatchObject({d: {session_id: "sess-1", seq: 41}});
		expect(user.session_id).toBe("sess-1");
		expect(user.resume_gateway_url).toBe("wss://resume.test");
	});

	it("a resume counts as a good connection, so the next drop resumes instead of reloading", async () => {
		const user = sessionUser();
		user.errorBackoff = 1;
		const done = user.initwebsocket(true);
		let settled = false;
		done.then(() => (settled = true));

		await resumeOn(FakeWebSocket.sockets[0]);

		expect(settled).toBe(true);
		expect(user.errorBackoff).toBe(0);
	});

	// A pin, not red-first: the old code forgot the session earlier (on sending RESUME).
	it("a refused resume (INVALID_SESSION) forgets the session", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const ws = FakeWebSocket.sockets[0];
		ws.emit("open", {});

		ws.emit("message", {data: JSON.stringify({op: 9, d: false})});
		await vi.advanceTimersByTimeAsync(0);

		expect(ws.closed).toBe(4041);
		expect(user.session_id).toBeUndefined();
		expect(user.resume_gateway_url).toBeUndefined();
	});

	it("a member lookup in flight when the socket drops is asked again after the resume", async () => {
		const user = sessionUser();
		Object.assign(user, {
			fetchingmembers: new Map(),
			noncemap: new Map(),
			noncebuild: new Map(),
			waitingmembers: new Map([["g1", new Map([["u1", () => {}]])]]),
			loaduser: () => {},
		});
		user.initwebsocket(true);
		const first = FakeWebSocket.sockets[0];
		await resumeOn(first);
		user.getmembers();
		await vi.advanceTimersByTimeAsync(20);
		expect(first.sent.filter((m) => m.op === 8)).toHaveLength(1);

		first.emit("close", {code: 1006});
		const second = FakeWebSocket.sockets[1];
		// The abandoned lookup's own re-ask comes due while the new socket is still connecting
		// (a send then would throw); it must wait for the resume instead.
		await vi.advanceTimersByTimeAsync(20);
		expect(second.sent).toEqual([]);
		await resumeOn(second);
		await vi.advanceTimersByTimeAsync(20);

		expect(second.sent.filter((m) => m.op === 8)).toHaveLength(1);
		expect(second.sent.find((m) => m.op === 8)).toMatchObject({d: {guild_id: "g1", user_ids: ["u1"]}});
	});
});
