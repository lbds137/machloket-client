import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Options} = await import("./settings");
const {Emoji} = await import("./emoji");
const {Guild} = await import("./guild");

const CDN = "https://cdn.test";

/** Builds an emoji input the way settings does, with a stub owner (no settings dialog around it). */
function emojiInput(initEmoji: InstanceType<typeof Emoji> | undefined, clear: boolean) {
	const owner = Object.assign(Object.create(Options.prototype), {
		options: [],
		generate() {},
		changed() {},
	}) as InstanceType<typeof Options>;
	const localuser = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
	return owner.addEmojiInput("Emoji", () => {}, localuser, {initEmoji, clear});
}

function customEmoji(id: string, name: string) {
	return new Emoji({id, name, animated: false}, {info: {cdn: CDN}} as unknown as InstanceType<
		typeof Guild
	>);
}

describe("an emoji input whose current emoji image is gone", () => {
	it("a pick after the fallback leaves exactly the new emoji in the slot", () => {
		const input = emojiInput(customEmoji("111", "wave"), false);
		const root = input.generateHTML();
		document.body.append(root);
		try {
			root.querySelector("img")?.dispatchEvent(new Event("error"));
			input.setEmoji(customEmoji("999", "party"));

			// The old fallback must be gone, not left beside the new emoji.
			expect(root.querySelector(".md-emoji-fallback")).toBeNull();
			const slot = root.querySelector(".emojiSlot");
			expect(slot?.children.length).toBe(1);
			expect(slot?.firstElementChild?.tagName).toBe("IMG");
			expect(slot?.firstElementChild?.getAttribute("src")).toContain("/emojis/999");
		} finally {
			root.remove();
		}
	});

	it("a clear after the fallback leaves only the empty placeholder", () => {
		const input = emojiInput(customEmoji("111", "wave"), true);
		const root = input.generateHTML();
		document.body.append(root);
		try {
			root.querySelector("img")?.dispatchEvent(new Event("error"));
			root.querySelector("button")?.click();

			// The old fallback must be gone, not left beside the placeholder.
			expect(root.querySelector(".md-emoji-fallback")).toBeNull();
			const slot = root.querySelector(".emojiSlot");
			expect(slot?.children.length).toBe(1);
			expect(slot?.firstElementChild?.classList.contains("emptyEmoji")).toBe(true);
		} finally {
			root.remove();
		}
	});
});
