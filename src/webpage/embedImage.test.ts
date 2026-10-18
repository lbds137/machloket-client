import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Embed} = await import("./embed");
type Args = ConstructorParameters<typeof Embed>;

function render(json: object) {
	const refreshIfNeeded = vi.fn(async (url: string) => url);
	const owner = {channel: {guild: {localuser: {refreshIfNeeded}}}};
	// A throw is what the defect looked like: the message lost everything drawn after the embed.
	try {
		return new Embed(json as unknown as Args[0], owner as unknown as Args[1]).generateHTML();
	} catch {
		return undefined;
	}
}

// The server's image embeds (pixiv) carry the picture as `image`, with no `thumbnail`.
it("an image embed that carries its picture as `image` shows it", async () => {
	const html = render({
		type: "image",
		image: {
			url: "https://i.example/full.png",
			proxy_url: "https://cdn.example/proxy/full.png",
			width: 600,
			height: 400,
		},
	});

	expect(html?.querySelector("img")).not.toBeNull();
	// The picture loads its source once it knows whether it moves.
	await vi.waitFor(() =>
		expect(html?.querySelector("img")?.src).toBe("https://cdn.example/proxy/full.png"),
	);
});

it("an image embed with no picture at all draws nothing rather than breaking the message", () => {
	const html = render({type: "image"});

	expect(html).toBeDefined();
	expect(html?.querySelector("img")).toBeNull();
});

it("a link preview's thumbnail still wins and is drawn at its scaled-down width", () => {
	const html = render({
		type: "image",
		thumbnail: {
			url: "https://i.example/t.png",
			proxy_url: "https://cdn.example/t.png",
			width: 576,
			height: 288,
		},
		image: {url: "https://i.example/other.png"},
	});

	expect(html?.querySelector<HTMLImageElement>("img")?.style.width).toBe("288px");
});
