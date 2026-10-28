import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {VoiceFactory} = await import("./voice");

// A fixed server answer with one audio and one video media. Every value cleanServerSDP
// echoes (ufrag/pwd/fingerprint/candidate/rtcp/mid/ports) comes from THIS string — the
// local RTCPeerConnection only contributes the media-section enumeration, which is
// deterministic for a fixed transceiver set.
const SERVER_SDP = [
	"v=0",
	"o=- 4611731400430051336 2 IN IP4 127.0.0.1",
	"s=-",
	"t=0 0",
	"a=group:BUNDLE 0 1",
	"m=audio 50044 UDP/TLS/RTP/SAVPF 111",
	"c=IN IP4 10.0.0.1",
	"a=rtcp:50044 IN IP4 10.0.0.1",
	"a=ice-ufrag:abcd",
	"a=ice-pwd:efghijklmnop",
	"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D",
	"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0",
	"a=rtpmap:111 opus/48000/2",
	"a=mid:0",
	"a=sendonly",
	"m=video 50044 UDP/TLS/RTP/SAVPF 96 97",
	"c=IN IP4 10.0.0.1",
	"a=rtcp:50044 IN IP4 10.0.0.1",
	"a=ice-ufrag:abcd",
	"a=ice-pwd:efghijklmnop",
	"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D",
	"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0",
	"a=rtpmap:96 H264/90000",
	"a=rtpmap:97 rtx/90000",
	"a=mid:1",
	"a=sendonly",
].join("\r\n");

describe("cleanServerSDP output pin", () => {
	// Slip-guard from the #30 review: the sweep once broke this builder (a brace + loop
	// index deletion) and greps could not see it. This pin locks the whole output string.
	it("rewrites the server SDP deterministically (audio+video, no camera)", async () => {
		const factory = new VoiceFactory({id: "me"}, () => {}, false);
		const voice = factory.makeVoice("g", "A", {bitrate: 64000});
		voice.users = new Map([[12345, "alice"]]);
		voice.vidusers = new Map([[69001, "bob"]]);
		voice.offer = "offer";
		const pc = new RTCPeerConnection();
		pc.addTransceiver("audio", {direction: "recvonly"});
		pc.addTransceiver("video", {direction: "recvonly"});
		await pc.setLocalDescription(await pc.createOffer());
		voice.pc = pc;
		const out = await voice.cleanServerSDP(SERVER_SDP);
		// The expected value is JSON.stringify's own output (compare is byte-exact; \r\r\n
		// doubles and all). "IN IP4 undefined" is the test bootstrap's urlobj shape, captured
		// as-is; production passes a real URL object there. Video payload types 102/103 come
		// from Chromium's fixed codec allocation for this transceiver set.
		// Byte-exact pin, split on CRLF so the expected is plain strings (no escape hazards).
		const pieces = out.split("\r\n");
		expect(pieces).toEqual(["v=0", "o=- 1420070400000 0 IN IP4 undefined", "s=-", "t=0 0", "a=msid-semantic: WMS *", "a=group:BUNDLE 0 1", "m=audio 50044 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 10.0.0.1\r", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1", "a=rtcp:50044 IN IP4 10.0.0.1\r", "a=rtcp-fb:111 transport-cc", "a=setup:passive", "a=mid:0", "a=maxptime:60", "a=sendonly", "a=ice-ufrag:abcd\r", "a=ice-pwd:efghijklmnop\r", "a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r", "a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r", "a=rtcp-mux", "m=video 50044 UDP/TLS/RTP/SAVPF 102 103", "c=IN IP4 10.0.0.1\r", "a=rtpmap:102 H264/90000", "a=rtpmap:103 rtx/90000", "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", "a=fmtp:103 apt=102", "a=rtcp:50044 IN IP4 10.0.0.1\r", "a=rtcp-fb:102 ccm fir", "a=rtcp-fb:102 nack", "a=rtcp-fb:102 nack pli", "a=rtcp-fb:102 goog-remb", "a=rtcp-fb:102 transport-cc", "a=setup:passive", "a=mid:1", "a=sendonly", "a=ice-ufrag:abcd\r", "a=ice-pwd:efghijklmnop\r", "a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r", "a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r", "a=rtcp-mux", ""]);
	});
});
