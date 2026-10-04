import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {voiceStatus} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {VoiceFactory} = await import("./voice");
const {FakeWebSocket} = await import("./test/gateway");

type Sent = {op: number; d: {channel_id: string | null}};

/** A factory for user "me" in guild "g" with voice channels A and B; gateway sends recorded. */
function voiceSetup() {
	const sent: Sent[] = [];
	const factory = new VoiceFactory({id: "me"}, (obj) => void sent.push(obj as Sent), false);
	const a = factory.makeVoice("g", "A", {bitrate: 64000});
	const b = factory.makeVoice("g", "B", {bitrate: 64000});
	return {factory, a, b, sent};
}

/** The VOICE_STATE_UPDATE Spacebar sends for "me" (channel null = left). */
function selfState(channel_id: string | null) {
	return {
		guild_id: "g",
		channel_id,
		user_id: "me",
		session_id: "s1",
		deaf: false,
		mute: false,
		self_deaf: false,
		self_mute: false,
		self_video: false,
		self_stream: false,
		suppress: false,
	} as unknown as voiceStatus;
}

describe("voice leave", () => {
	beforeEach(() => {
		FakeWebSocket.sockets = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("switching channels keeps you in the new one when the old one's leave echoes back", async () => {
		const {factory, sent} = voiceSetup();
		factory.joinVoice("A", "g");
		factory.voiceStateUpdate(selfState("A"));

		factory.joinVoice("B", "g");
		// The server answers the switch's op 4 null, then op 4 B.
		factory.voiceStateUpdate(selfState(null));
		factory.voiceStateUpdate(selfState("B"));
		await Promise.resolve();

		const states = sent.filter((m) => m.op === 4).map((m) => m.d.channel_id);
		expect(states.at(-1)).toBe("B");
		expect(factory.curChan).toBe("B");
	});

	it("joining the call you're already in (a double tap) keeps you in it", async () => {
		const {factory, sent} = voiceSetup();
		factory.joinVoice("A", "g");
		factory.voiceStateUpdate(selfState("A"));
		const before = sent.length;

		factory.joinVoice("A", "g");

		// Nothing goes out: no op 4 null whose echo would then kick you from A.
		expect(sent.slice(before)).toEqual([]);
		expect(factory.curChan).toBe("A");
	});

	it("switching away from a call still connecting closes it", async () => {
		const {factory, a} = voiceSetup();
		factory.joinVoice("A", "g");

		factory.joinVoice("B", "g");

		expect(a.open).toBe(false);
	});

	it("a state update while the first join waits for the voice server opens one socket, not two", async () => {
		const {factory, a} = voiceSetup();
		factory.joinVoice("A", "g");
		const first = a.startWS("s1", "g");
		const second = a.startWS("s1", "g");

		a.urlobj.url = "voice.test";
		a.urlobj.gotUrl?.();
		await Promise.race([Promise.all([first, second]), new Promise((res) => setTimeout(res, 50))]);

		expect(FakeWebSocket.sockets).toHaveLength(1);
	});

	it("leaving twice tells the app once", async () => {
		const {factory, a} = voiceSetup();
		factory.joinVoice("A", "g");
		const left = vi.fn();
		a.onLeave = left;

		await a.leave();
		await a.leave();

		expect(left).toHaveBeenCalledTimes(1);
	});

	it("an old socket closing late doesn't end the rejoined call", async () => {
		const {factory, a} = voiceSetup();
		a.urlobj.url = "voice.test";
		factory.joinVoice("A", "g");
		void a.startWS("s1", "g");
		const first = FakeWebSocket.sockets[0];

		await a.leave();
		factory.joinVoice("A", "g");
		void a.startWS("s1", "g");
		const second = FakeWebSocket.sockets[1];
		(first as unknown as {onclose: () => void}).onclose();

		expect(a.open).toBe(true);
		expect(a.ws).toBe(second);
	});
});
