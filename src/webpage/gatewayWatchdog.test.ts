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

	/** A user mid-session with the maps the close path's member-request abandonment reads. */
	function sessionUser() {
		const user = gatewayUser();
		user.session_id = "sess-1";
		user.resume_gateway_url = "wss://resume.test";
		Object.assign(user, {
			loaduser: () => {},
			fetchingmembers: new Map(),
			memberLookupDrops: new Map(),
			noncemap: new Map(),
			noncebuild: new Map(),
			waitingmembers: new Map(),
		});
		return user;
	}

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

	it("a hostile HELLO cannot arm a sub-second heartbeat loop", async () => {
		const timers = vi.spyOn(globalThis, "setInterval");
		try {
			for (const hostile of [1, "abc", 2 ** 31]) {
				FakeWebSocket.sockets = [];
				const user = gatewayUser();
				user.initwebsocket();
				const ws = FakeWebSocket.sockets[0];
				ws.emit("open", {});
				// heartbeat_interval is server data (CodeQL #17, sweep class H): the armed
				// delay must be a real number within [1s, 2^31-1] — never tiny, NaN, or
				// overflow (Chromium fires the last two ~immediately). The tiny case also
				// pins the beat itself: exactly one op-40 at 1000ms, none sooner.
				ws.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: hostile}})});
				const armed = timers.mock.calls.length;
				await vi.advanceTimersByTimeAsync(0);
				expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(1);
				const beatDelay = (timers.mock.calls[armed] as [unknown, number])[1];
				expect(beatDelay).toBeGreaterThanOrEqual(1000);
				expect(beatDelay).toBeLessThanOrEqual(2 ** 31 - 1);
				if (hostile === 1) {
					await vi.advanceTimersByTimeAsync(999);
					expect(ws.sent.filter((m) => m.op === 40)).toHaveLength(0);
					await vi.advanceTimersByTimeAsync(1);
					expect(ws.sent.filter((m) => m.op === 40)).toHaveLength(1);
				}
			}
		} finally {
			timers.mockRestore();
		}
	});

	it("a socket whose HELLO never comes is closed and replaced", async () => {
		const user = gatewayUser();
		void user.initwebsocket();
		const A = FakeWebSocket.sockets[0];
		A.emit("open", {});
		// The watchdog arms only at HELLO; before it, a 30s deadline is all that stands
		// between a silent server and a splash that never lifts.
		await vi.advanceTimersByTimeAsync(29_000);
		expect(A.closed).toBeUndefined();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(A.closed).toBe(4000);
		expect(FakeWebSocket.sockets).toHaveLength(2);
		expect(user.ws).toBe(FakeWebSocket.sockets[1]);
	});

	it("a HELLO that arrives in time leaves the socket alone", async () => {
		const ws = await connect(gatewayUser());
		// Frames keep coming, so the watchdog stays quiet; only a leftover HELLO deadline
		// could close it.
		for (let t = 0; t < 60_000; t += 4_000) {
			await vi.advanceTimersByTimeAsync(4_000);
			ws.emit("message", {data: JSON.stringify({op: 11, d: null})});
		}
		expect(ws.closed).toBeUndefined();
	});

	it("a replaced socket's late HELLO doesn't call off its replacement's deadline", async () => {
		const user = gatewayUser();
		void user.initwebsocket();
		const A = FakeWebSocket.sockets[0];
		await vi.advanceTimersByTimeAsync(31_000);
		const B = FakeWebSocket.sockets[1];
		expect(user.ws).toBe(B);
		// A's HELLO finally shows up after A was given up on.
		A.emit("open", {});
		A.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);
		B.emit("open", {});
		// B's failure is the second in a row, so the close path would take the backoff branch
		// (splash DOM this harness doesn't build); recording the call is all this test needs.
		const socketClosed = vi.fn();
		user.socketClosed = socketClosed;
		await vi.advanceTimersByTimeAsync(31_000);
		expect(B.closed).toBe(4000);
		expect(socketClosed).toHaveBeenCalledWith(B, 4000);
	});

	it("an old socket's deadline doesn't close the socket that replaced it", async () => {
		const user = gatewayUser();
		void user.initwebsocket();
		await vi.advanceTimersByTimeAsync(10_000);
		// A new connection starts before the first one's deadline (an account reconnect).
		void user.initwebsocket();
		const B = FakeWebSocket.sockets[1];
		B.emit("open", {});
		B.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);
		// Past the first socket's 30s mark; B is talking.
		for (let t = 0; t < 28_000; t += 4_000) {
			await vi.advanceTimersByTimeAsync(4_000);
			B.emit("message", {data: JSON.stringify({op: 11, d: null})});
		}
		expect(B.closed).toBeUndefined();
		expect(user.ws).toBe(B);
	});

	it("a gateway URL the browser refuses goes to the reconnect path, not a rejection", async () => {
		const user = gatewayUser();
		const loaduser = vi.fn();
		user.loaduser = loaduser;
		let refused = false;
		vi.stubGlobal(
			"WebSocket",
			class extends FakeWebSocket {
				constructor(url: string) {
					// The first construction throws, as the browser does on a malformed URL.
					if (!refused) {
						refused = true;
						throw new DOMException("bad url", "SyntaxError");
					}
					super(url);
				}
			},
		);
		let outcome = "pending";
		user.initwebsocket().then(
			() => (outcome = "resolved"),
			() => (outcome = "rejected"),
		);
		await vi.advanceTimersByTimeAsync(0);
		// The startup chain builds the app on resolve: a socket that never existed must not
		// resolve it, and a rejection would go unhandled at every caller.
		expect(outcome).toBe("pending");
		expect(loaduser).not.toHaveBeenCalled();
		// The close path's first retry runs at once and gets a socket.
		expect(FakeWebSocket.sockets).toHaveLength(1);
		expect(user.ws).toBe(FakeWebSocket.sockets[0]);
		expect(user.errorBackoff).toBe(1);
	});

	it("a browser without DecompressionStream connects uncompressed", async () => {
		const saved = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
		// Deleting it (not stubbing undefined) makes the bare identifier a ReferenceError.
		delete (globalThis as {DecompressionStream?: unknown}).DecompressionStream;
		try {
			const user = gatewayUser();
			void user.initwebsocket();
			const ws = FakeWebSocket.sockets[0];
			expect(ws).toBeDefined();
			expect(ws.url).not.toContain("compress");
			ws.emit("open", {});
			expect(ws.sent.find((m) => m.op === 2)).toMatchObject({d: {compress: false}});
		} finally {
			if (saved) Object.defineProperty(globalThis, "DecompressionStream", saved);
		}
		expect(typeof DecompressionStream).toBe("function");
	});

	it("a watchdog kill reconnects immediately; the browser's late close event is ignored", async () => {
		const user = sessionUser();
		user.initwebsocket(true);
		const A = FakeWebSocket.sockets[0];
		A.emit("open", {});
		A.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);

		// Past the 30s silence floor the next watchdog tick lands at 35s.
		await vi.advanceTimersByTimeAsync(40_000);
		// The reconnect already ran — no close event needed.
		expect(FakeWebSocket.sockets).toHaveLength(2);
		const B = FakeWebSocket.sockets[1];
		expect(user.ws).toBe(B);
		B.emit("open", {});
		await vi.advanceTimersByTimeAsync(0);
		// The session survived the kill: B resumes it.
		expect(B.sent.find((m) => m.op === 6)).toMatchObject({d: {session_id: "sess-1"}});

		// The browser's close handshake for the watchdog-killed socket arrives late.
		A.emit("close", {code: 4000});
		await vi.advanceTimersByTimeAsync(0);

		expect(FakeWebSocket.sockets).toHaveLength(2);
		expect(user.ws).toBe(B);
		expect(user.errorBackoff).toBe(1);
		expect(user.heartbeatTimer).toBeUndefined();
	});
});
