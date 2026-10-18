import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
const {Localuser} = await import("./localuser");
const {VoiceFactory} = await import("./voice");
const {FakeWebSocket} = await import("./test/gateway");

beforeEach(() => {
	FakeWebSocket.sockets = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => vi.unstubAllGlobals());

/** A factory in a call on channel A of guild g; gateway sends recorded. */
function inCall() {
	const sent: {op: number}[] = [];
	const factory = new VoiceFactory({id: "me"}, (obj) => void sent.push(obj as {op: number}), false);
	const voice = factory.makeVoice("g", "A", {bitrate: 64000});
	factory.joinVoice("A", "g");
	voice.open = true;
	const stop = vi.fn();
	voice.micTrack = {stop} as never;
	sent.length = 0;
	return {factory, voice, sent, stop};
}

it("unloading the account ends its call, quietly", () => {
	const {factory, voice, sent, stop} = inCall();
	const user = Object.assign(Object.create(Localuser.prototype), {
		voiceFactory: factory,
		// An unload keeps every channel's waiting files: a session with no channels keeps none.
		channelids: new Map(),
		disconnectComposer: () => {},
		outoffocus: () => {},
		stopHeartbeat: () => {},
	});

	user.unload();

	expect(stop).toHaveBeenCalled();
	expect(voice.open).toBe(false);
	expect(factory.currentVoice).toBeUndefined();
	// The gateway session is gone or replaced: a leave there could end a call made since.
	expect(sent.filter((m) => m.op === 4)).toEqual([]);
});
