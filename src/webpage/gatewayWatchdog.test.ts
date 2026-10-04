import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");

describe("gateway heartbeat and watchdog", () => {
	beforeEach(() => {
		FakeWebSocket.sockets = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	/** Opens a socket and hands it HELLO with a 5s heartbeat interval (few timer fires per
	 * advance keeps the fake-clock run fast and deterministic). The listener's send rides a
	 * microtask chain, so the flush matters. */
	async function connect(user: ReturnType<typeof gatewayUser>) {
		user.initwebsocket();
		const ws = FakeWebSocket.sockets[0];
		ws.emit("open", {});
		ws.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);
		return ws;
	}

	it("heartbeats keep their own schedule — no ACK needed for the next one", async () => {
		const ws = await connect(gatewayUser());
		// HELLO sends the first beat immediately…
		expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(1);
		// …and three intervals pass with NO op 11 ever; the scheduled beats are op-40 QoS.
		await vi.advanceTimersByTimeAsync(15_000);
		expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(1);
		expect(ws.sent.filter((m) => m.op === 40)).toHaveLength(3);
		expect(ws.sent.find((m) => m.op === 40)).toMatchObject({
			d: {seq: 0, qos: {ver: 27, active: expect.any(Boolean), reasons: expect.any(Array)}},
		});
	});

	it("a Discord-shaped ACK (d: null) still marks the connection good", async () => {
		const user = gatewayUser();
		const ws = await connect(user);
		ws.emit("message", {data: JSON.stringify({op: 11, d: null})});
		await vi.advanceTimersByTimeAsync(0);
		expect(user.connectionSucceed).not.toBe(0);
	});

	it("an ACKed beat schedules nothing — one beat per interval, however long it runs", async () => {
		const ws = await connect(gatewayUser());
		// The fork ACKs op 1 AND op 40 (both reach onHeartbeat, each a DB write), so an op-11
		// handler that answers with another beat starts one more chain every interval.
		let acked = 0;
		const ackEveryBeat = () => {
			const beats = ws.sent.filter((m) => m.op === 1 || m.op === 40).length;
			// `d: {}` is the fork's exact ACK — handleEvent reads `d._trace` before the op branch.
			for (; acked < beats; acked++) {
				ws.emit("message", {data: JSON.stringify({op: 11, d: {}})});
			}
		};
		ackEveryBeat();
		const perInterval: number[] = [];
		for (let i = 0; i < 8; i++) {
			const before = ws.sent.length;
			await vi.advanceTimersByTimeAsync(5000);
			perInterval.push(ws.sent.length - before);
			ackEveryBeat();
		}
		expect(perInterval).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
	});

	it("silence past the deadline closes the zombie so the reconnect path runs", async () => {
		const ws = await connect(gatewayUser());
		// The watchdog's floor is 30s and the check is strict — 40s of unanswered silence.
		await vi.advanceTimersByTimeAsync(40_000);
		expect(ws.closed).toBe(4000);
	});

	it("an arriving frame pushes the deadline back", async () => {
		const ws = await connect(gatewayUser());
		await vi.advanceTimersByTimeAsync(20_000);
		ws.emit("message", {data: JSON.stringify({op: 11, d: null})});
		await vi.advanceTimersByTimeAsync(20_000);
		// 20s of silence since the last frame: still open.
		expect(ws.closed).toBeUndefined();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(ws.closed).toBe(4000);
	});

	it("a HELLO without a heartbeat interval still arms a working watchdog", async () => {
		const user = gatewayUser();
		user.initwebsocket();
		const ws = FakeWebSocket.sockets[0];
		ws.emit("open", {});
		// No heartbeat_interval in HELLO: the default (41.25s) must keep the timers sane —
		// not ~4ms spam, not NaN that never fires.
		ws.emit("message", {data: JSON.stringify({op: 10, d: {}})});
		await vi.advanceTimersByTimeAsync(0);
		expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(1);
		// The deadline is 2×41.25s = 82.5s and the check is strict; the next watchdog tick
		// after that lands at 123.75s.
		await vi.advanceTimersByTimeAsync(130_000);
		expect(ws.closed).toBe(4000);
	});
});
