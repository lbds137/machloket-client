import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {makePlayBox, MediaPlayer} = await import("./media");

const WAV =
	"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

afterEach(() => {
	vi.restoreAllMocks();
});

const thing = {src: WAV, filename: "a.wav", title: "t", length: 1000};

function playerOf() {
	return {
		addListener: vi.fn(),
		addUpdate: vi.fn(),
		isPlaying: () => true,
		setToTopList: vi.fn(),
		end: vi.fn(),
	};
}

const charCodes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const synchsafe = (n: number) => [((n >> 21) & 0x7f) | 0, ((n >> 14) & 0x7f) | 0, ((n >> 7) & 0x7f) | 0, n & 0x7f];

/** A minimal ID3v2.4 tag (version 4.0, no flags, synchsafe sizes, no padding): enough for
 * IdentifyFile, which returns the parsed metadata even without a decodable audio body. */
function id3v24(frames: {id: string; payload: number[]}[]) {
	const body: number[] = [];
	for (const {id, payload} of frames) {
		body.push(...charCodes(id), ...synchsafe(payload.length), 0, 0, ...payload);
	}
	const bytes = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, ...synchsafe(body.length), ...body];
	return new Blob([new Uint8Array(bytes)], {type: "audio/mpeg"});
}

async function identify(blob: Blob) {
	const url = URL.createObjectURL(blob);
	try {
		return await MediaPlayer.IdentifyFile(url);
	} finally {
		URL.revokeObjectURL(url);
	}
}

it("a v2.4 multi-value text frame shows all its values", async () => {
	// Encoding 3 (UTF-8), then two NUL-separated values: "A", "B".
	const med = await identify(id3v24([{id: "TPE1", payload: [3, ...charCodes("A"), 0, ...charCodes("B")]}]));

	expect(med?.artist).toBe("A / B");
});

it("a v2.4 file's year comes from TDRC when TYER is gone", async () => {
	const med = await identify(id3v24([{id: "TDRC", payload: [3, ...charCodes("2021")]}]));

	expect(med?.year).toBe(2021);
});

it("a TYER year still sets the year", async () => {
	const med = await identify(id3v24([{id: "TYER", payload: [3, ...charCodes("2020")]}]));

	expect(med?.year).toBe(2020);
});

it("a play box removed mid-play stops ticking into the player", async () => {
	vi.spyOn(MediaPlayer, "IdentifyFile").mockResolvedValue(thing as never);
	const player = playerOf();

	const box = makePlayBox({src: WAV} as never, player as never, 0, undefined);
	document.body.append(box);
	await vi.waitFor(() => expect(player.addListener).toHaveBeenCalled());

	// The tick only fires addUpdate while the button (an img) reads pause.
	box.querySelector("img")!.classList.add("svg-pause");
	await new Promise((res) => setTimeout(res, 250));
	const whileAttached = player.addUpdate.mock.calls.length;
	expect(whileAttached).toBeGreaterThan(0);

	box.remove();
	await new Promise((res) => setTimeout(res, 300));
	expect(player.addUpdate.mock.calls.length).toBe(whileAttached);
});
