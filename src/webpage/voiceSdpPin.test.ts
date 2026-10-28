import {describe, expect, it, onTestFinished} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {VoiceFactory} = await import("./voice");

// A fixed server answer with one audio and one video media. Every value cleanServerSDP
// echoes (ufrag/pwd/fingerprint/candidate/rtcp/mid/ports) comes from THIS string — the
// local RTCPeerConnection only contributes the media-section enumeration. The pwd value
// is an obvious fixture string, not a credential (GitGuardian flagged the earlier
// efghijklmnop as a generic password).
const SERVER_SDP = [	"v=0",
	"o=- 4611731400430051336 2 IN IP4 127.0.0.1",
	"s=-",
	"t=0 0",
	"a=group:BUNDLE 0 1",
	"m=audio 50044 UDP/TLS/RTP/SAVPF 111",
	"c=IN IP4 10.0.0.1",
	"a=rtcp:50044 IN IP4 10.0.0.1",
	"a=ice-ufrag:abcd",
	"a=ice-pwd:fixturepwdnotasecret00",
	"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D",
	"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0",
	"a=rtpmap:111 opus/48000/2",
	"a=mid:0",
	"a=sendonly",
	"m=video 50044 UDP/TLS/RTP/SAVPF 96 97",
	"c=IN IP4 10.0.0.1",
	"a=rtcp:50044 IN IP4 10.0.0.1",
	"a=ice-ufrag:abcd",
	"a=ice-pwd:fixturepwdnotasecret00",
	"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D",
	"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0",
	"a=rtpmap:96 H264/90000",
	"a=rtpmap:97 rtx/90000",
	"a=mid:1",
	"a=sendonly",
].join("\r\n");

describe("cleanServerSDP output pin", () => {
	// Slip-guard from the #30 review: the sweep once broke this builder (a brace + loop
	// index deletion) and greps could not see it. cleanServerSDP reads audioUsers[-1] /
	// videoUsers[-1] on each media kind's FIRST section and only reaches real users on the
	// SECOND — so the fixture mounts TWO transceivers per kind, pinning the index-sensitive
	// msid/ssrc/mode branches through the captured output.
	it("rewrites the server SDP deterministically (2 audio + 2 video, no camera)", async () => {
		const factory = new VoiceFactory({id: "me"}, () => {}, false);
		const voice = factory.makeVoice("g", "A", {bitrate: 64000});
		voice.urlobj.url = "voice.test";
		voice.users = new Map([
			[12345, "alice"],
			[12346, "carol"],
		]);
		voice.vidusers = new Map([
			[69001, "bob"],
			[77777, voice.userid],
		]);
		voice.offer = "offer";
		const pc = new RTCPeerConnection();
		onTestFinished(() => pc.close());
		pc.addTransceiver("audio", {direction: "recvonly"});
		pc.addTransceiver("video", {direction: "recvonly"});
		pc.addTransceiver("audio", {direction: "recvonly"});
		pc.addTransceiver("video", {direction: "recvonly"});
		await pc.setLocalDescription(await pc.createOffer());
		voice.pc = pc;
		const out = await voice.cleanServerSDP(SERVER_SDP);
		// The self vidusers entry (same id as the local userid) must be dropped by the
		// no-camera path before the SDP is built.
		expect(voice.vidusers.has(77777)).toBe(false);
		const pieces = out.split("\r\n");
		// Byte-exact pin — EXCEPT the video payload-type tokens: Chromium's H264/rtx PT
		// allocation is not stable across runs or transceiver sets (102/103 vs 102/97 were
		// both observed), so both sides are normalized to <h264pt>/<rtxpt> role markers
		// before compare. PT VALUES are Chromium's, not the builder's; everything else —
		// structure, ports, ICE echo, msid ordering, the \r\r\n doubles — is byte-pinned.
		// The \r\r\n doubles are a known builder defect, captured as-is; tracked in the
		// project tracker; this pin will need updating when it is fixed.
		const norm = (arr: string[]) =>
			arr.map((s) =>
				s
					.replace(/UDP\/TLS\/RTP\/SAVPF \d+ \d+$/, "UDP/TLS/RTP/SAVPF <h264pt> <rtxpt>")
					.replace(/:\d+ H264\/90000/, ":<h264pt> H264/90000")
					.replace(/:\d+ rtx\/90000/, ":<rtxpt> rtx/90000")
					.replace(/:\d+ level-asymmetry/, ":<h264pt> level-asymmetry")
					.replace(/apt=\d+$/, "apt=<h264pt>"),
			);
		expect(norm(pieces)).toEqual([
			"v=0",
			"o=- 1420070400000 0 IN IP4 voice.test",
			"s=-",
			"t=0 0",
			"a=msid-semantic: WMS *",
			"a=group:BUNDLE 0 1 2 3",
			"m=audio 50044 UDP/TLS/RTP/SAVPF 111",
			"c=IN IP4 10.0.0.1\r",
			"a=rtpmap:111 opus/48000/2",
			"a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1",
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			"a=rtcp-fb:111 transport-cc",
			"a=setup:passive",
			"a=mid:0",
			"a=maxptime:60",
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=rtcp-mux",
			"m=video 50044 UDP/TLS/RTP/SAVPF <h264pt> <rtxpt>",
			"c=IN IP4 10.0.0.1\r",
			"a=rtpmap:<h264pt> H264/90000",
			"a=rtpmap:<rtxpt> rtx/90000",
			"a=fmtp:<h264pt> level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
			"a=fmtp:103 apt=<h264pt>",
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			"a=rtcp-fb:102 ccm fir",
			"a=rtcp-fb:102 nack",
			"a=rtcp-fb:102 nack pli",
			"a=rtcp-fb:102 goog-remb",
			"a=rtcp-fb:102 transport-cc",
			"a=setup:passive",
			"a=mid:1",
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=rtcp-mux",
			"m=audio 50044 UDP/TLS/RTP/SAVPF 111",
			"c=IN IP4 10.0.0.1\r",
			"a=rtpmap:111 opus/48000/2",
			"a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1",
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			"a=rtcp-fb:111 transport-cc",
			"a=setup:passive",
			"a=mid:2",
			"a=msid:alice-12345 aalice-12345",
			"a=maxptime:60",
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=ssrc:12345 cname:alice-12345",
			"a=rtcp-mux",
			"m=video 50044 UDP/TLS/RTP/SAVPF <h264pt> <rtxpt>",
			"c=IN IP4 10.0.0.1\r",
			"a=rtpmap:<h264pt> H264/90000",
			"a=rtpmap:<rtxpt> rtx/90000",
			"a=fmtp:<h264pt> level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
			"a=fmtp:103 apt=<h264pt>",
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			"a=rtcp-fb:102 ccm fir",
			"a=rtcp-fb:102 nack",
			"a=rtcp-fb:102 nack pli",
			"a=rtcp-fb:102 goog-remb",
			"a=rtcp-fb:102 transport-cc",
			"a=setup:passive",
			"a=mid:3",
			"a=msid:bob-69001 vbob-69001",
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=ssrc:69001 cname:bob-69001",
			"a=rtcp-mux",
			"",
		]);
	});
});
