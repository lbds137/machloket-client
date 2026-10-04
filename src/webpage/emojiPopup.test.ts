import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {Emoji} = await import("./emoji");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll(".EmojiGuildMenu").forEach((e) => e.remove());
});

describe("tapping a custom emoji", () => {
	it("from a server you can't see still opens its card, marked private", async () => {
		vi.spyOn(Emoji, "lookupEmoji").mockResolvedValue(undefined);
		const owner = {info: {cdn: "http://cdn.test", api: "http://api.test"}, headers: {}};
		const emoji = new Emoji({id: "900", name: "partyblob"}, owner as never);
		const img = emoji.getHTML();
		document.body.append(img);

		img.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX: 10, clientY: 10}));

		await vi.waitFor(() => {
			const card = document.querySelector(".EmojiGuildMenu");
			expect(card?.textContent).toContain(I18n.emoji.found.private());
		});
		img.remove();
	});
});
