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

	// A frame body the parser stores verbatim: [id-size-flags already written by the builder]
	function rawTag(version: 3 | 4, frames: {id: string; flag2: number; body: number[]}[]) {
		const body: number[] = [];
		for (const {id, flag2, body: payload} of frames) {
			const size = version === 4 ? synchsafe(payload.length) : plain4(payload.length);
			body.push(...charCodes(id), ...size, 0, flag2, ...payload);
		}
		return new Blob(
			[new Uint8Array([0x49, 0x44, 0x33, version, 0, 0, ...synchsafe(body.length), ...body])],
			{type: "audio/mpeg"},
		);
	}
	async function compressedFrame(text: string, declaredOverride?: number) {
		const payload = [0, ...charCodes(text), 0];
		const packed = await deflate(payload);
		const declared = declaredOverride ?? payload.length;
		return {id: "TIT2", flag2: 0b10000000, body: [...plain4(declared), ...packed]};
	}

	it("a compressed frame declaring less than it inflates to is abandoned, not stored", async () => {
		// 1 MB of 'a' deflates small; the header claims 4 bytes. The stream must be abandoned
		// mid-read: the title falls back to the short filename, never the inflated megabyte.
		const filler: number[] = new Array(1_000_000).fill(97); // 'a'
		const payload = [0, ...filler, 0];
		const packed = await deflate(payload);
		const blob = rawTag(3, [
			{id: "TIT2", flag2: 0b10000000, body: [...plain4(4), ...packed]},
		]);
		const title = await titleOf(blob);
		// The real assertion is the short fallback: the payload is all 'a's, so any
		// "not Zipped" check would be vacuous here.
		expect((title ?? "").length).toBeLessThan(100);
	});

	it("a compressed frame whose declared size passes the cap is skipped without inflating", async () => {
		const packed = await deflate([0, ...charCodes("Zipped"), 0]);
		// Declares ~9 MiB, over the parser's 8 MiB ceiling: skipped by header alone.
		const declared = 9 * 1024 * 1024;
		const blob = rawTag(3, [
			{id: "TIT2", flag2: 0b10000000, body: [...plain4(declared), ...packed]},
		]);
		const title = await titleOf(blob);
		expect(title).not.toBe("Zipped");
		expect((title ?? "").length).toBeLessThan(100);
	});

	it("duplicate compressed frames keep the first and still consume the second", async () => {
		const first = await compressedFrame("First");
		const second = await compressedFrame("Second");
		const title = await titleOf(rawTag(3, [first, second]));
		expect(title).toBe("First");
	});

	it("a corrupt compressed stream falls back to the filename instead of hanging", async () => {
		const title = await titleOf(
			rawTag(3, [{id: "TIT2", flag2: 0b10000000, body: [...plain4(64), 1, 2, 3, 4, 5]}]),
		);
		expect((title ?? "").length).toBeLessThan(100);
	});

	it("a corrupt compressed stream loses its frame, not the whole tag", async () => {
		const survivor = await compressedFrame("Survivor");
		const title = await titleOf(
			rawTag(3, [
				{id: "TIT2", flag2: 0b10000000, body: [...plain4(64), 1, 2, 3, 4, 5]},
				survivor,
			]),
		);
		expect(title).toBe("Survivor");
	});

	it("a grouped compressed frame keeps its group byte and still decompresses", async () => {
		// v2.3 extra fields follow the flag order i,j,k: the decompressed size first, then
		// the group identifier byte, then the data.
		const payload = [0, ...charCodes("Zipped"), 0];
		const packed = await deflate(payload);
		const title = await titleOf(
			rawTag(3, [
				{id: "TIT2", flag2: 0b10100000, body: [...plain4(payload.length), 7, ...packed]},
			]),
		);
		expect(title).toBe("Zipped");
	});

	it("an encrypted frame is skipped without derailing the rest of the tag", async () => {
		const plain = await compressedFrame("Zipped");
		const title = await titleOf(
			rawTag(3, [{id: "TENC", flag2: 0b01000000, body: [1, 2, 3, 4]}, plain]),
		);
		expect(title).toBe("Zipped");
	});
});
