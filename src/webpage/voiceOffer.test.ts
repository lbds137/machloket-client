import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {VoiceFactory} = await import("./voice");

describe("makeOffer", () => {
	it("rejects without a peer connection instead of never settling, and can be asked again", async () => {
		const factory = new VoiceFactory({id: "me"}, () => {}, false);
		const voice = factory.makeVoice("g", "A", {bitrate: 64000});

		const outcome = await Promise.race([
			voice.makeOffer().then(
				() => "resolved",
				() => "rejected",
			),
			new Promise<string>((res) => setTimeout(() => res("hung"), 1500)),
		]);
		expect(outcome).toBe("rejected");
		expect(voice.off).toBeUndefined();
	});
});

describe("the server's op 2 packet", () => {
	it("marks the connection failed when the offer can't be made", async () => {
		const factory = new VoiceFactory({id: "me"}, () => {}, false);
		const voice = factory.makeVoice("g", "A", {bitrate: 64000});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(voice, "makeOffer").mockRejectedValue(new Error("no offer"));

		await voice.packet(new MessageEvent("message", {data: JSON.stringify({op: 2, d: {}})}));

		await vi.waitFor(() => expect(voice.status).toBe("conectionFailed"), {timeout: 3000});
	});
});
