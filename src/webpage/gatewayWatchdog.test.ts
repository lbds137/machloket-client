import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Localuser} = await import("./localuser");

/** Just enough of a WebSocket to drive initwebsocket: listeners the app registers, the
 * frames we emit, the sends we inspect. close() only records — the reconnect path's own
 * handler is deliberately not exercised here. */
class FakeWebSocket {
	static sockets: FakeWebSocket[] = [];
	url: string;
	sent: {op: number}[] = [];
	closed: number | undefined;
	listeners = new Map<string, ((e: {data?: string}) => void)[]>();
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.sockets.push(this);
	}
	addEventListener(type: string, fn: (e: {data?: string}) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	send(data: string) {
		this.sent.push(JSON.parse(data) as {op: number});
	}
	close(code?: number) {
		this.closed = code ?? 1000;
	}
	emit(type: string, event: {data?: string}) {
		for (const fn of this.listeners.get(type) ?? []) fn(event);
	}
}

/** A Localuser with only what initwebsocket and the op-10/op-11 handlers read. `token` is
 * getter-only on the prototype, so it needs a real own property. */
function gatewayUser() {
	const user = Object.assign(Object.create(Localuser.prototype), {
		serverurls: {gateway: "wss://gw.test"},
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
		heartbeat_interval: 0,
		lastFrameAt: 0,
		heartbeatTimer: undefined,
		watchdogTimer: undefined,
		lastSequence: 0,
		connectionSucceed: 0,
		errorBackoff: 0,
		swapped: false,
		guilds: [],
		guildids: new Map(),
		generateFavicon: () => {},
	});
	Object.defineProperty(user, "token", {value: "t", writable: true});
	return user;
}

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
		const ws = FakeWebSocket.sockets[0] as FakeWebSocket;
		ws.emit("open", {});
		ws.emit("message", {data: JSON.stringify({op: 10, d: {heartbeat_interval: 5000}})});
		await vi.advanceTimersByTimeAsync(0);
		return ws;
	}

	it("heartbeats keep their own schedule — no ACK needed for the next one", async () => {
		const ws = await connect(gatewayUser());
		// HELLO sends the first beat immediately…
		expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(1);
		// …and three intervals pass with NO op 11 ever.
		await vi.advanceTimersByTimeAsync(15_000);
		expect(ws.sent.filter((m) => m.op === 1)).toHaveLength(4);
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
		const ws = FakeWebSocket.sockets[0] as FakeWebSocket;
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
