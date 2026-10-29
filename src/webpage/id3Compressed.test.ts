import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MediaPlayer} = await import("./media");

const charCodes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const plain4 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

async function deflate(bytes: number[]): Promise<number[]> {
	const stream = new Blob([new Uint8Array(bytes)])
		.stream()
		.pipeThrough(new CompressionStream("deflate"));
	return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

/** A tag whose single TIT2 frame carries the compression flag in the parser's (v2.3) position,
 * bit 7 of the second flag byte: a 4-byte decompressed size then zlib data. Frame sizes follow
 * the tag's version (plain v2.3, synchsafe v2.4). NOTE: this is NOT a conforming v2.4 compressed
 * frame — v2.4 §4.1 puts compression on bit 3 (0x08) and mandates a Data Length Indicator; see
 * the tracker's v2.4-flags row. This case pins the synchsafe frame-size arithmetic only. */
async function compressedTag(version: 3 | 4, text: string) {
	const payload = [0, ...charCodes(text), 0]; // Latin-1 encoding byte, NUL-terminated
	const packed = await deflate(payload);
	const decompSize = version === 4 ? synchsafe(payload.length) : plain4(payload.length);
	const frameSize = version === 4 ? synchsafe(4 + packed.length) : plain4(4 + packed.length);
	const body = [...charCodes("TIT2"), ...frameSize, 0x00, 0b10000000, ...decompSize, ...packed];
	return new Blob(
		[new Uint8Array([0x49, 0x44, 0x33, version, 0, 0, ...synchsafe(body.length), ...body])],
		{type: "audio/mpeg"},
	);
}

async function titleOf(blob: Blob) {
	const url = URL.createObjectURL(blob);
	try {
		return (await MediaPlayer.IdentifyFile(url))?.title;
	} finally {
		URL.revokeObjectURL(url);
	}
}

// Fermo's TODO said "Honestly, I don't know if I can do this with normal JS" — the gateway
// already ships DecompressionStream, so compressed frames are readable in the browser.
describe("AUDIT (backlog #11): compressed ID3 frames", () => {
	it("a v2.3 compressed title frame is decompressed, not skipped", async () => {
		await expect(titleOf(await compressedTag(3, "Zipped"))).resolves.toBe("Zipped");
	});

	it("a v2.4-sized tag with a compressed title frame (bit 7 position) is decompressed too", async () => {
		// Pins the synchsafe frame-size arithmetic, not conforming v2.4 compression (see the
		// fixture comment: real v2.4 uses flag bit 3 plus a Data Length Indicator).
		await expect(titleOf(await compressedTag(4, "Zipped"))).resolves.toBe("Zipped");
	});
});
