import {afterEach, beforeEach, expect, it, vi} from "vitest";
import type {voiceStatus} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Voice, VoiceFactory} = await import("./voice");
const {FakeWebSocket} = await import("./test/gateway");

beforeEach(() => {
	FakeWebSocket.sockets = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function setup() {
	const factory = new VoiceFactory({id: "me"}, () => {}, false);
	const voice = factory.makeVoice("g", "A", {bitrate: 64000});
	return {factory, voice};
}

const state = (user_id: string, channel_id: string | null) =>
	({guild_id: "g", channel_id, user_id, session_id: "s"}) as unknown as voiceStatus;

const packet = (voice: InstanceType<typeof Voice>, json: unknown) =>
	voice.packet(new MessageEvent("message", {data: JSON.stringify(json)}));

it("a user leaving frees their own audio slot, not one named after their speaking flag", () => {
	const {voice} = setup();
	voice.users.set(5555, "u2");
	voice.speakingMap.set("u2", 1);
	const ourSender = {} as RTCRtpSender;
	voice.ssrcMap.set(ourSender, 1);

	voice.disconnect("u2");

	expect(voice.users.get(5555)).toBe("");
	expect(voice.users.has(1)).toBe(false);
	expect(voice.ssrcMap.get(ourSender)).toBe(1);
});

it("a heartbeat scheduled before a leave doesn't fire on the next call's socket", async () => {
	vi.useFakeTimers();
	const {voice} = setup();
	voice.open = true;
	voice.ws = new FakeWebSocket("ws://old") as unknown as WebSocket;
	await packet(voice, {op: 8, d: {heartbeat_interval: 30000}});

	await voice.leave();
	const fresh = new FakeWebSocket("ws://new");
	fresh.readyState = FakeWebSocket.OPEN;
	const send = vi.spyOn(fresh, "send");
	voice.ws = fresh as unknown as WebSocket;
	vi.advanceTimersByTime(1500);

	expect(send).not.toHaveBeenCalled();
});

it("setting the mic up again doesn't start a second speaking check", async () => {
	vi.useFakeTimers();
	const {voice} = setup();
	voice.ws = new FakeWebSocket("ws://v") as unknown as WebSocket;

	await voice.setupMic();
	await voice.setupMic();

	expect(vi.getTimerCount()).toBe(1);
});

it("a video waiting for its camera stops waiting once the call is left", async () => {
	vi.useFakeTimers();
	const {voice} = setup();
	voice.open = true;
	const started = voice.startVideo(new MediaStream());

	await voice.leave();
	await vi.advanceTimersByTimeAsync(500);

	expect(vi.getTimerCount()).toBe(0);
	await started;
});

it("joining a channel with no voice leaves the current call and state alone", () => {
	const {factory} = setup();
	factory.joinVoice("A", "g");
	const current = factory.currentVoice!;
	const leave = vi.spyOn(current, "leave");

	expect(() => factory.joinVoice("nope", "g")).toThrow();
	expect(leave).not.toHaveBeenCalled();
	expect(factory.curChan).toBe("A");
});

it("a repeated 'left voice' for someone fires one leave", () => {
	const {factory} = setup();
	const left = vi.fn();
	factory.onLeave = left;
	factory.voiceStateUpdate(state("u2", "A"));

	factory.voiceStateUpdate(state("u2", null));
	factory.voiceStateUpdate(state("u2", null));

	expect(left).toHaveBeenCalledTimes(1);
});

it("an SDP attribute keeps everything after its first '='", () => {
	const sdp = Voice.parsesdp(
		"v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=fmtp:111 minptime=10;useinbandfec=1",
	);

	expect([...sdp.medias[0].atr.get("fmtp")!]).toEqual(["111 minptime=10;useinbandfec=1"]);
});

it("with no camera, our own video entry is dropped by its SSRC", async () => {
	const {voice} = setup();
	voice.vidusers.set(7777, "me");
	voice.vidusers.set(8888, "u2");
	vi.spyOn(voice, "getCamInfo").mockResolvedValue({} as never);

	// No connection yet, so it stops right after the video bookkeeping.
	await voice.cleanServerSDP("").catch(() => {});

	expect([...voice.vidusers]).toEqual([[8888, "u2"]]);
});
