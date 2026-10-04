import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {makePlayBox, MediaPlayer} = await import("./media");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => vi.unstubAllGlobals());

describe("an audio attachment that fails to load", () => {
	it("says so instead of Loading... forever, and the next render tries again", async () => {
		const url = "http://cdn.test/attachments/1/2/voice.mp3";
		const fetchSpy = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
		vi.stubGlobal("fetch", fetchSpy);

		const box = makePlayBox(url, {} as never, 0, undefined);

		await vi.waitFor(() => expect(box.textContent).toContain(I18n.media.notFound()));
		expect(await MediaPlayer.IdentifyFile(url)).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});
