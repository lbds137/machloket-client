import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MarkDown} = await import("./markdown");
const {I18n} = await import("./i18n");
await I18n.done;

/** Whether a sent message renders as jumbo (big) emoji. */
const jumbo = (txt: string) => {
	const html = new MarkDown(txt, undefined).makeHTML();
	return html.matches(".bigemojiUni") || html.querySelector(".bigemojiUni") !== null;
};

it.each(["?", "!", "#", "€", "я", "好", "? !"])(
	"%s is text, not an emoji: it stays text-sized",
	(txt) => {
		expect(jumbo(txt)).toBe(false);
	},
);

it.each(["😀😀", "😀😀😀", "😀 😀 😀 😀", "❤️❤️❤️", "👨‍👩‍👧", "🇫🇷🇩🇪", "1️⃣"])(
	"%s is only emoji: it renders big",
	(txt) => {
		expect(jumbo(txt)).toBe(true);
	},
);

it("more than 30 emoji are text-sized, as on Discord", () => {
	expect(jumbo("😀".repeat(31))).toBe(false);
	expect(jumbo("😀".repeat(30))).toBe(true);
});

it("a skin tone, and emoji on separate lines, still count as emoji only", () => {
	expect(jumbo("👍🏽")).toBe(true);
	expect(jumbo("😀\r\n😀")).toBe(true);
});

it("a shortcode longer than ten characters renders big", () => {
	vi.spyOn(MarkDown, "getEmoji").mockReturnValue({name: "grinning_squinting", emoji: "😆"});

	expect(jumbo(":grinning_squinting:")).toBe(true);
	vi.restoreAllMocks();
});

// Pins, not red-first: the old code got these right.
it("a single emoji renders big; a bare digit, a non-emoji <…> or emoji with words don't", () => {
	expect(jumbo("😀")).toBe(true);
	expect(jumbo("❤")).toBe(true);
	expect(jumbo("1")).toBe(false);
	expect(jumbo("<x>")).toBe(false);
	expect(jumbo("hello 😀")).toBe(false);
});
