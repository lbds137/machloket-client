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

/** An ID3v2 tag (major version 3 or 4) holding the given frames, then some audio bytes. */
function id3(major: 3 | 4, frames: [string, number[]][]) {
	const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
	const plain = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
	const body: number[] = [];
	for (const [id, data] of frames) {
		body.push(...[...id].map((c) => c.charCodeAt(0)), ...(major === 4 ? synchsafe : plain)(data.length), 0, 0, ...data);
	}
	body.push(...new Array(16).fill(0));
	return new Uint8Array([0x49, 0x44, 0x33, major, 0, 0, ...synchsafe(body.length), ...body, ...new Array(64).fill(0xff)]);
}
const utf16le = (s: string) => [0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]), 0, 0];
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

describe("reading an audio file's tags", () => {
	let n = 0;
	async function identify(bytes: Uint8Array<ArrayBuffer>) {
		vi.stubGlobal("fetch", async () => new Response(bytes));
		return (await MediaPlayer.IdentifyFile(`http://cdn.test/attachments/1/2/tagged-${n++}.mp3`))!;
	}

	it("reads ID3v2.4 frames (synchsafe sizes) and UTF-16 and UTF-8 text", async () => {
		const long = "A long song title ".repeat(8).trim(); // over 127 bytes once UTF-16
		const media = await identify(
			id3(4, [
				["TIT2", [1, ...utf16le(long)]],
				["TPE1", [3, ...utf8("Artiste é")]],
			]),
		);
		expect(media.title).toBe(long);
		expect(media.artist).toBe("Artiste é");
	});

	it("reads a tag whose revision byte isn't 0 (2.4.1)", async () => {
		const tag = id3(4, [["TIT2", [3, ...utf8("Rev")]]]);
		tag[4] = 1;
		expect((await identify(tag)).title).toBe("Rev");
	});

	it("reads ID3v2.3 Latin-1 text", async () => {
		const media = await identify(id3(3, [["TIT2", [0, ...[..."café"].map((c) => c.charCodeAt(0)), 0]]]));
		expect(media.title).toBe("café");
	});

	it("settles the length even when the file can't be loaded or decoded", async () => {
		const media = await identify(id3(3, [["TIT2", [3, ...utf8("x")]]]));
		const settled = await Promise.race([
			Promise.resolve(media.length).then(() => true),
			new Promise((res) => setTimeout(() => res(false), 3000)),
		]);
		expect(settled).toBe(true);
	});
});
