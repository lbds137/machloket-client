import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {makePlayBox, MediaPlayer} = await import("./media");

const WAV =
	"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const thing = {src: WAV, filename: "a.wav", title: "t", length: 1000};

/** Stands in for the browser's Audio so the test decides when the file has loaded. Like a
 * browser, it starts an autoplay element once its data has loaded, unless pause() was called
 * first (pause() clears the autoplaying flag, per the HTML spec). */
class FakeAudio {
	static made: FakeAudio[] = [];
	autoplay = false;
	currentTime = 0;
	src: string;
	onloadeddata: (() => void) | null = null;
	onplay: (() => void) | null = null;
	onpause: (() => void) | null = null;
	onended: (() => void) | null = null;
	load = vi.fn();
	play = vi.fn(() => Promise.resolve());
	pause = vi.fn(() => {
		this.autoplay = false;
	});
	constructor(src: string) {
		this.src = src;
		FakeAudio.made.push(this);
	}
	/** The browser finishing the load: an autoplay element starts now. */
	finishLoading() {
		this.onloadeddata?.();
		if (this.autoplay) this.play();
	}
}

function playerOf() {
	return {
		addListener: vi.fn(),
		addUpdate: vi.fn(),
		isPlaying: () => true,
		setToTopList: vi.fn(),
		end: vi.fn(),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	// boxFor reads FakeAudio.made[0] as "this test's element": a stale one from an earlier test
	// would otherwise be the one under test.
	FakeAudio.made.length = 0;
});

/** A play box for track A, attached, with its player-update listener and fake element. */
async function boxFor() {
	vi.stubGlobal("Audio", FakeAudio);
	vi.spyOn(MediaPlayer, "IdentifyFile").mockResolvedValue(thing as never);
	const player = playerOf();
	const box = makePlayBox({src: WAV} as never, player as never, 0, undefined);
	document.body.append(box);
	await vi.waitFor(() => expect(FakeAudio.made).toHaveLength(1));
	const followUpdates = player.addListener.mock.calls[0][1] as (e: {type: string}) => void;
	return {box, player, followUpdates, element: FakeAudio.made[0]};
}

it("a track that is not ended autoplays once it has loaded (control for the fake)", async () => {
	const {box, element} = await boxFor();

	element.finishLoading();

	expect(element.play).toHaveBeenCalledTimes(1);
	box.remove();
});

// AUDIT B-F3 (introduced by a27b47c8): an "end" arriving before track A's data has loaded finds
// no `audio` yet (it is only set in onloadeddata), so nothing pauses A, and A then starts over
// the next track, invisibly.
it("a track ended before it loads does not start once it loads", async () => {
	const {box, followUpdates, element} = await boxFor();

	followUpdates({type: "end"});
	element.finishLoading();

	expect(element.play).not.toHaveBeenCalled();
	box.remove();
});
