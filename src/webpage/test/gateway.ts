// Callers import ./localuser before this module, in the entry's order (see the suites using it).
const {Localuser} = await import("../localuser");

/** Just enough of a WebSocket to drive initwebsocket: listeners the app registers, the
 * frames we emit, the sends we inspect. close() only records; a test that wants the app's
 * close handler to run emits "close" itself. */
export class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static sockets: FakeWebSocket[] = [];
	readyState = FakeWebSocket.CONNECTING;
	url: string;
	sent: {op: number; d?: unknown}[] = [];
	closed: number | undefined;
	listeners = new Map<string, ((e: {data?: string; code?: number}) => void)[]>();
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.sockets.push(this);
	}
	addEventListener(type: string, fn: (e: {data?: string; code?: number}) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	send(data: string) {
		// Like the browser's: sending before "open" throws InvalidStateError.
		if (this.readyState !== FakeWebSocket.OPEN) throw new DOMException("still connecting", "InvalidStateError");
		this.sent.push(JSON.parse(data) as {op: number});
	}
	close(code?: number) {
		this.closed = code ?? 1000;
	}
	emit(type: string, event: {data?: string; code?: number}) {
		if (type === "open") this.readyState = FakeWebSocket.OPEN;
		for (const fn of this.listeners.get(type) ?? []) fn(event);
	}
}

/** A Localuser with only what initwebsocket and the op-10/op-11 handlers read. `token` is
 * getter-only on the prototype, so it needs a real own property. */
export function gatewayUser() {
	const user = Object.assign(Object.create(Localuser.prototype), {
		serverurls: {gateway: "wss://gw.test"},
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
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
