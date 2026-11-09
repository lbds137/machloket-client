import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
const {Localuser} = await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");
const {I18n} = await import("./i18n");

const API = "http://status.test/api/v9";

// Swapped by hand: vi.unstubAllGlobals would also drop the setup's fetch stub.
const RealWebSocket = globalThis.WebSocket;
beforeEach(() => {
	FakeWebSocket.sockets = [];
	globalThis.WebSocket = FakeWebSocket as never;
	sessionStorage.clear();
});
afterEach(() => {
	globalThis.WebSocket = RealWebSocket;
	sessionStorage.clear();
});

/** The status this account's IDENTIFY announces, in a tab that never set one. */
function identifiedStatus(stored: string | undefined) {
	const user = gatewayUser();
	user.userinfo = {status: stored};
	user.initwebsocket();
	const ws = FakeWebSocket.sockets.at(-1)!;
	ws.emit("open", {});
	const identify = ws.sent.find((m) => m.op === 2) as {d: {presence: {status: string}}};
	return identify.d.presence.status;
}

it("a new tab connects with the account's own status", () => {
	expect(identifiedStatus("invisible")).toBe("invisible");
	expect(identifiedStatus("dnd")).toBe("dnd");
});

it("an account with no known status connects invisible until its settings arrive", () => {
	expect(identifiedStatus(undefined)).toBe("invisible");
});

it("READY's saved status is remembered, and announced when the connect used another", () => {
	const user = gatewayUser();
	user.userinfo = {status: undefined};
	const setstatus = vi.fn();
	user.user = {setstatus};
	user.initwebsocket();
	const ws = FakeWebSocket.sockets[0];
	ws.emit("open", {});

	user.applySavedStatus("online");

	expect(user.userinfo.status).toBe("online");
	expect(setstatus).toHaveBeenCalledWith("online");
	expect(ws.sent.filter((m) => m.op === 3)).toEqual([
		{op: 3, d: {status: "online", since: null, activities: [], afk: false}},
	]);

	// Already announced: the same status again sends nothing.
	user.applySavedStatus("online");
	expect(ws.sent.filter((m) => m.op === 3)).toHaveLength(1);
});

it("a settings row without a status keeps what the connection announced", () => {
	const user = gatewayUser();
	const setstatus = vi.fn();
	user.user = {setstatus};
	user.initwebsocket();
	const ws = FakeWebSocket.sockets.at(-1)!;
	ws.emit("open", {});

	user.applySavedStatus(null);

	expect(ws.sent.filter((m) => m.op === 3)).toEqual([]);
	expect(user.userinfo.status).toBeUndefined();
	expect(setstatus).toHaveBeenCalledWith("invisible");
});

it("a status picked in the dialog is remembered and announced on this connection", async () => {
	await I18n.done;
	captureRequests(API + "/users/@me/settings", () => Response.json({}));
	const user = gatewayUser();
	Object.assign(user, {
		info: {api: API},
		headers: {},
		user: {setstatus: () => {}, status: "online"},
	});
	user.initwebsocket();
	const ws = FakeWebSocket.sockets.at(-1)!;
	ws.emit("open", {});

	Localuser.openStatusDialog(user);
	const select = document.querySelector("select")!;
	select.selectedIndex = 1; // online, invisible, dnd, idle
	select.dispatchEvent(new Event("change"));

	await vi.waitFor(() => expect(user.userinfo.status).toBe("invisible"));
	// Identified invisible (nothing remembered), so there's nothing new to announce yet.
	select.selectedIndex = 2;
	select.dispatchEvent(new Event("change"));
	await vi.waitFor(() =>
		expect(ws.sent.filter((m) => m.op === 3)).toEqual([
			{op: 3, d: {status: "dnd", since: null, activities: [], afk: false}},
		]),
	);
	document.body.replaceChildren();
});

it("a status picked while the socket is down goes out once the session resumes", async () => {
	const user = gatewayUser();
	Object.assign(user, {
		session_id: "sess-1",
		resume_gateway_url: "wss://resume.test",
		user: {setstatus: () => {}},
		identifiedStatus: "online",
		getmembers: () => {},
	});
	user.initwebsocket(true);
	const ws = FakeWebSocket.sockets.at(-1)!;

	// Still connecting: sending would throw, so it's only remembered.
	expect(() => user.announceStatus("invisible")).not.toThrow();
	expect(user.userinfo.status).toBe("invisible");

	ws.emit("open", {});
	ws.emit("message", {data: JSON.stringify({op: 0, t: "RESUMED", s: 42, d: {}})});
	await vi.waitFor(() =>
		expect(ws.sent.filter((m) => m.op === 3)).toEqual([
			{op: 3, d: {status: "invisible", since: null, activities: [], afk: false}},
		]),
	);
});
