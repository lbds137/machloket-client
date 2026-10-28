import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Tag} = await import("./tag");
type Channel = import("./channel").Channel;

// Tag.owner is a Channel, but makeHTML's emoji path only reaches owner.guild.info.cdn —
// a stub shaped for that read is the lightest fixture that typechecks.
function makeTag(fields: {name: string; emoji_id?: string; emoji_name?: string}): InstanceType<typeof Tag> {
	const tag = Object.create(Tag.prototype) as InstanceType<typeof Tag>;
	tag.name = fields.name;
	tag.emoji_id = fields.emoji_id;
	tag.emoji_name = fields.emoji_name;
	tag.owner = {
		guild: {info: {cdn: "https://cdn.tagfixture.test"}},
	} as unknown as Channel;
	return tag;
}

describe("forum tag emoji rendering", () => {
	it("renders a custom emoji (emoji_id) as the emoji image before the name", () => {
		const tag = makeTag({name: " lore", emoji_id: "1234", emoji_name: ":stars:"});
		const html = tag.makeHTML();
		const img = html.querySelector("img.md-emoji");
		expect(img).not.toBeNull();
		expect(img?.getAttribute("src")).toContain("https://cdn.tagfixture.test/emojis/1234.");
		expect(img?.getAttribute("alt")).toBe(":stars:");
		expect(html.querySelector("span")?.textContent).toBe(" lore");
	});

	it("renders a unicode tag emoji (emoji_name only) as text before the name", () => {
		const tag = makeTag({name: " wins", emoji_name: "🎯"});
		const html = tag.makeHTML();
		expect(html.textContent).toContain("🎯");
		expect(html.querySelector("img")).toBeNull();
		expect(html.querySelector("span")?.textContent).toBe(" wins");
	});

	it("renders name only when the tag has no emoji", () => {
		const tag = makeTag({name: "plain"});
		const html = tag.makeHTML();
		expect(html.querySelector("img")).toBeNull();
		expect(html.textContent).toBe("plain");
	});
});
