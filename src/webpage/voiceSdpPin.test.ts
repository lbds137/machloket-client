import {describe, expect, it, onTestFinished} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {VoiceFactory} = await import("./voice");

// A fixed server answer with one audio and one video media. Every value cleanServerSDP
// echoes (ufrag/pwd/fingerprint/candidate/rtcp/mid/ports) comes from THIS string — the
// local RTCPeerConnection only contributes the media-section enumeration. The pwd value
// is an obvious fixture string, not a credential.
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
	// msid/ssrc/mode branches through the expected array below.
	//
	// Known builder quirks captured as-is (fixing them means regenerating the expected):
	// - the output carries \r\r\n line doubles (server lines' trailing \r plus the
	//   template's own); tracked in the project tracker as a defect;
	// - the video rtx payload type (port2) is "the first rtx line seen after H264" in the
	//   local section, not necessarily the rtx whose apt= names the H264 PT.
	// OUT OF SCOPE here: the settings.stream branch and the camera-present path (they need
	// a media-stream fixture); a slip there is not caught by this pin.
	//
	// The video sections' payload types come from Chromium's local allocation and are not
	// stable across runs or transceiver sets, so each expected video section interpolates
	// the PTs read from the OUTPUT's own m=video line — the pin stays green whatever
	// Chromium picks while still requiring every line in the section to agree with its
	// m= line (a swapped port1/port2 in any fmtp/rtcp-fb/rtpmap line goes red).
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
		const videoPTs = pieces
			.filter((s) => s.startsWith("m=video "))
			.map((s) => s.match(/SAVPF (\d+) (\d+)$/)!.slice(1) as [string, string]);
		expect(videoPTs).toHaveLength(2);
		const video1 = (mid: string, pt1: string, pt2: string) => [
			`m=video 50044 UDP/TLS/RTP/SAVPF ${pt1} ${pt2}`,
			"c=IN IP4 10.0.0.1\r",
			`a=rtpmap:${pt1} H264/90000`,
			`a=rtpmap:${pt2} rtx/90000`,
			`a=fmtp:${pt1} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f`,
			`a=fmtp:${pt2} apt=${pt1}`,
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			`a=rtcp-fb:${pt1} ccm fir`,
			`a=rtcp-fb:${pt1} nack`,
			`a=rtcp-fb:${pt1} nack pli`,
			`a=rtcp-fb:${pt1} goog-remb`,
			`a=rtcp-fb:${pt1} transport-cc`,
			"a=setup:passive",
			`a=mid:${mid}`,
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=rtcp-mux",
		];
		const video2 = (mid: string, pt1: string, pt2: string) => [
			`m=video 50044 UDP/TLS/RTP/SAVPF ${pt1} ${pt2}`,
			"c=IN IP4 10.0.0.1\r",
			`a=rtpmap:${pt1} H264/90000`,
			`a=rtpmap:${pt2} rtx/90000`,
			`a=fmtp:${pt1} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f`,
			`a=fmtp:${pt2} apt=${pt1}`,
			"a=rtcp:50044 IN IP4 10.0.0.1\r",
			`a=rtcp-fb:${pt1} ccm fir`,
			`a=rtcp-fb:${pt1} nack`,
			`a=rtcp-fb:${pt1} nack pli`,
			`a=rtcp-fb:${pt1} goog-remb`,
			`a=rtcp-fb:${pt1} transport-cc`,
			"a=setup:passive",
			`a=mid:${mid}`,
			"a=msid:bob-69001 vbob-69001",
			"a=sendonly",
			"a=ice-ufrag:abcd\r",
			"a=ice-pwd:fixturepwdnotasecret00\r",
			"a=fingerprint:sha-256 4B:32:D2:3D:21:80:50:14:FB:8D:D9:78:3E:35:61:BC:57:80:70:35:AB:EF:70:15:61:1E:34:7A:7B:32:10:9D\r",
			"a=candidate:1234 1 udp 2122260223 10.0.0.1 50044 typ host generation 0\r",
			"a=ssrc:69001 cname:bob-69001",
			"a=rtcp-mux",
			"",
		];
		expect(pieces).toEqual([
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
			...video1("1", ...videoPTs[0]),
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
			...video2("3", ...videoPTs[1]),
		]);
	});
});
