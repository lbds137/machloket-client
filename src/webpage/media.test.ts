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
