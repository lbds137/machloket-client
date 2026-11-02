import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Embed} = await import("./embed");
type Args = ConstructorParameters<typeof Embed>;

const VIDEO_URL = "https://www.youtube.com/embed/e2eFixtured01";

/** The player a tap on the poster swaps in, for a video embed with these sizes. */
function tappedPlayer(video: object, thumbnail: object = {width: 480, height: 360}) {
	const refreshIfNeeded = vi.fn(async (url: string) => url);
	const owner = {channel: {guild: {localuser: {refreshIfNeeded}}}};
	const json = {
		type: "video",
		author: {},
		provider: {name: "YouTube"},
		title: "clip",
		video: {url: VIDEO_URL, ...video},
		thumbnail: {url: "https://i.example/poster.jpg", ...thumbnail},
	};
	const html = new Embed(json as unknown as Args[0], owner as unknown as Args[1]).generateHTML();
	html.querySelector<HTMLImageElement>("img")!.click();
	return html.querySelector("iframe")!;
}

// A 4:3 poster on a 16:9 video is why the video's own size comes first: the poster's shape
// letterboxes the player.
it("the player takes its size from the video, not its poster", () => {
	const player = tappedPlayer({width: 1280, height: 720});

	expect(player.style.width).toBe("1280px");
	expect(player.style.aspectRatio).toBe("1280 / 720");
});

it.each([
	["no size", {}],
	["null sizes", {width: null, height: null}],
	["only a width", {width: 1280}],
	["only a height", {height: 720}],
])("a video with %s takes the poster's size whole", (_label, video) => {
	const player = tappedPlayer(video);

	expect(player.style.width).toBe("480px");
	expect(player.style.aspectRatio).toBe("480 / 360");
});

it("with no size on either, the player is left to its default box", () => {
	const player = tappedPlayer({}, {});

	expect(player.style.width).toBe("");
	expect(player.style.aspectRatio).toBe("");
});
