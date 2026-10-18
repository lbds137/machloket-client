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

it("a first socket that drops before READY still builds the app once the retry is READY", async () => {
	// No session yet: this is the app's very first connect.
	const user = gatewayUser();
	const loaduser = vi.fn();
	const init = vi.fn(async () => {});
	Object.assign(user, {
		loaduser,
		init,
		handleEvent: async () => {},
		abandonMemberRequests: () => {},
	});
	// The startup chain waits on this promise (index.ts), which only READY settles.
	user.initwebsocket();
	FakeWebSocket.sockets[0].emit("close", {code: 1006});
	await vi.advanceTimersByTimeAsync(0);

	const retry = FakeWebSocket.sockets[1];
	expect(retry).toBeDefined();
	retry.emit("open", {});
	retry.emit("message", {data: JSON.stringify({op: 0, t: "READY", s: 1, d: {}})});
	await vi.advanceTimersByTimeAsync(0);

	expect(loaduser).toHaveBeenCalledTimes(1);
	expect(init).toHaveBeenCalledTimes(1);
});
