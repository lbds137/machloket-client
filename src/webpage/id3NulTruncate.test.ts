import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MediaPlayer} = await import("./media");

const charCodes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const plain3 = (n: number) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const plain4 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** An ID3v2 tag of the given major version: v2.2 has 3-byte frame ids and sizes, v2.3 plain
 * 4-byte sizes, v2.4 synchsafe sizes. Each payload is an encoding byte then the text. */
function id3(version: 2 | 3 | 4, frames: {id: string; payload: number[]}[]) {
	const body: number[] = [];
	for (const {id, payload} of frames) {
		if (version === 2) {
			body.push(...charCodes(id), ...plain3(payload.length), ...payload);
		} else {
			const size = version === 4 ? synchsafe(payload.length) : plain4(payload.length);
			body.push(...charCodes(id), ...size, 0, 0, ...payload);
		}
	}
	const bytes = [0x49, 0x44, 0x33, version, 0, 0, ...synchsafe(body.length), ...body];
	return new Blob([new Uint8Array(bytes)], {type: "audio/mpeg"});
}

async function titleOf(blob: Blob) {
	const url = URL.createObjectURL(blob);
	try {
		return (await MediaPlayer.IdentifyFile(url))?.title;
	} finally {
		URL.revokeObjectURL(url);
	}
}

// AUDIT B-F6 (introduced by 49caac6f): decodeId3Text splits every NUL-separated value and joins
// them with " / ", which is the v2.4 multi-value rule. Before v2.4 the spec says the text ends at
// the first terminator, so the bytes after it are not a second value and must not be shown.
describe("AUDIT B-F6: NUL-terminated ID3 text below v2.4", () => {
	it("a v2.3 title is truncated at its NUL terminator", async () => {
		// Encoding 0 (Latin-1), "Song", NUL, then "junk" after the terminator.
		const title = await titleOf(
			id3(3, [{id: "TIT2", payload: [0, ...charCodes("Song"), 0, ...charCodes("junk")]}]),
		);

		expect(title).toBe("Song");
	});

	it("a v2.2 title is truncated at its NUL terminator", async () => {
		const title = await titleOf(
			id3(2, [{id: "TT2", payload: [0, ...charCodes("Song"), 0, ...charCodes("junk")]}]),
		);

		expect(title).toBe("Song");
	});

	it("a v2.4 title still shows every NUL-separated value", async () => {
		// Encoding 3 (UTF-8): the v2.4 multi-value rule keeps both values.
		const title = await titleOf(
			id3(4, [{id: "TIT2", payload: [3, ...charCodes("Song"), 0, ...charCodes("junk")]}]),
		);

		expect(title).toBe("Song / junk");
	});
});
