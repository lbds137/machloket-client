import {afterEach, beforeEach, expect, it, vi} from "vitest";

// How the session drives the bar; the bar itself is recoveryBanner.test.ts.
await import("./localuser");
const {FakeWebSocket, gatewayUser} = await import("./test/gateway");

function frame(ws: InstanceType<typeof FakeWebSocket>, t: string, d: unknown) {
	ws.emit("message", {data: JSON.stringify({op: 0, t, s: 42, d})});
}

async function connected(state: {initialized: boolean; swapped?: boolean}) {
	const user = gatewayUser();
	user.session_id = "sess-1";
	user.resume_gateway_url = "wss://resume.test";
	Object.assign(user, state);
	user.initwebsocket(true);
	const ws = FakeWebSocket.sockets[0];
	ws.emit("open", {});
	await vi.advanceTimersByTimeAsync(0);
	return {user, ws, banner: user.recoveryBannerState};
}

beforeEach(() => {
	FakeWebSocket.sockets = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("a resume reads the state again, since the drop can have missed an event", async () => {
	const {ws, banner} = await connected({initialized: true});
	frame(ws, "RESUMED", {});
	await vi.advanceTimersByTimeAsync(0);
	expect(banner.refresh).toHaveBeenCalledTimes(1);
});

it("a resume on an account switched away from reads nothing: the bar is the new account's", async () => {
	const {ws, banner} = await connected({initialized: true, swapped: true});
	frame(ws, "RESUMED", {});
	await vi.advanceTimersByTimeAsync(0);
	expect(banner.refresh).not.toHaveBeenCalled();
});

it("a live session passes the event on", async () => {
	const {ws, banner} = await connected({initialized: true});
	const update = {status: "pending", completes_at: "2026-11-05T12:00:00Z"};
	frame(ws, "MFA_RECOVERY_UPDATE", update);
	await vi.advanceTimersByTimeAsync(0);
	expect(banner.apply).toHaveBeenCalledWith(update);
});

it("a session that isn't initialized ignores the event", async () => {
	const {ws, banner} = await connected({initialized: false});
	frame(ws, "MFA_RECOVERY_UPDATE", {status: "pending"});
	await vi.advanceTimersByTimeAsync(0);
	expect(banner.apply).not.toHaveBeenCalled();
});

it("unloading takes the bar down, so it can't sit over the next account", async () => {
	const {user, banner} = await connected({initialized: true});
	vi.spyOn(user, "disconnectComposer").mockImplementation(() => {});
	vi.spyOn(user, "outoffocus").mockImplementation(() => {});
	user.unload();
	expect(banner.stop).toHaveBeenCalledTimes(1);
});
