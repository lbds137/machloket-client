import {afterEach, beforeEach, describe, expect, it} from "vitest";

await import("./localuser");
const {Emoji} = await import("./emoji.js");
const {Contextmenu} = await import("./contextmenu.js");
const {I18n} = await import("./i18n.js");
const {BinWrite} = await import("./utils/binaryUtils.js");
const {applySkinTone, getSkinTone, setSkinTone} = await import("./utils/skinTone.js");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: styleCss}: {default: string} = await import("./public/style.css?inline");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: themesCss}: {default: string} = await import("./themes.css?inline");
await I18n.done;

const savedEmojis = Emoji.emojis;

function codepoints(str: string): number[] {
	return Array.from(str, (ch) => ch.codePointAt(0)!);
}

function extractRuleBlock(sheet: string, selector: string): string {
	const start = sheet.indexOf(`${selector} {`);
	if (start === -1) return "";
	const openBrace = sheet.indexOf("{", start);
	let depth = 0;
	for (let i = openBrace; i < sheet.length; i++) {
		if (sheet[i] === "{") depth++;
		else if (sheet[i] === "}") {
			depth--;
			if (depth === 0) {
				return sheet.slice(start, i + 1);
			}
		}
	}
	return "";
}

function assignTwoEmojiFixture() {
	Emoji.emojis = [
		{
			name: "Test",
			emojis: [
				{name: "waving hand", emoji: "👋", skin_tone_support: true},
				{name: "grinning", emoji: "😀", skin_tone_support: false},
			],
		},
	];
}

describe("EMOJI-B skin tone & EMOJI-E footer", () => {
	beforeEach(() => {
		localStorage.removeItem("emojiSkinTone");
	});

	afterEach(() => {
		Emoji.emojis = savedEmojis;
		localStorage.removeItem("emojiSkinTone");
		Contextmenu.declareMenu();
		document.querySelectorAll(".emojiPicker, .emojiTonePopup").forEach((el) => el.remove());
	});

	it("1. decode keeps skin_tone_support on Emoji.emojis entries", () => {
		const writer = new BinWrite(1024);
		writer.write16(1);
		writer.writeString16("Test");
		writer.write16(2);

		const waveBytes = new TextEncoder().encode("👋");
		writer.writeString8("alpha");
		writer.write8(waveBytes.byteLength + 128);
		writer.writeStringNo("👋");

		const grinBytes = new TextEncoder().encode("😀");
		writer.writeString8("beta");
		writer.write8(grinBytes.byteLength);
		writer.writeStringNo("😀");

		Emoji.emojis = [];
		Emoji.decodeEmojiList(writer.getBuffer());

		expect(Emoji.emojis).toHaveLength(1);
		const group = Emoji.emojis[0]!;
		expect(group.name).toBe("Test");
		expect(group.emojis).toHaveLength(2);
		expect(group.emojis[0]?.name).toBe("alpha");
		expect(group.emojis[0]?.emoji).toBe("👋");
		expect(group.emojis[0]?.skin_tone_support).toBe(true);
		expect(group.emojis[1]?.name).toBe("beta");
		expect(group.emojis[1]?.emoji).toBe("😀");
		expect(group.emojis[1]?.skin_tone_support).toBe(false);
	});

	it("2. applySkinTone synthesizes tone 1-5 variants and leaves tone 0 or out-of-range unchanged", () => {
		expect(applySkinTone("👋", 0)).toBe("👋");
		expect(applySkinTone("👋", 1)).toBe("👋🏻");
		expect(applySkinTone("👋", 2)).toBe("👋🏼");
		expect(applySkinTone("👋", 5)).toBe("👋🏿");
		expect(applySkinTone("👋", 9)).toBe("👋");
		expect(applySkinTone("👋", -1)).toBe("👋");
	});

	it("2b. applySkinTone drops FE0F on FE0F-defaulted base ✌️", () => {
		expect(applySkinTone("✌️", 1)).toBe("✌🏻");
		expect(codepoints(applySkinTone("✌️", 1))).toEqual([0x270c, 0x1f3fb]);
		expect(applySkinTone("✌️", 5)).toBe("✌🏿");
	});

	it("2c. applySkinTone inserts modifier after first codepoint on 🧔‍♂️", () => {
		expect(codepoints(applySkinTone("🧔\u200d♂️", 2))).toEqual([
			0x1f9d4, 0x1f3fc, 0x200d, 0x2642, 0xfe0f,
		]);
	});

	it("2d. applySkinTone inserts modifier after first codepoint and drops first FE0F on 🕵️‍♂️", () => {
		expect(codepoints(applySkinTone("🕵️\u200d♂️", 3))).toEqual([
			0x1f575, 0x1f3fd, 0x200d, 0x2642, 0xfe0f,
		]);
	});

	it("3. preference getSkinTone and setSkinTone persist and guard corrupt storage", () => {
		expect(getSkinTone()).toBe(0);

		setSkinTone(3);
		expect(getSkinTone()).toBe(3);

		for (const poisoned of ["junk", "null", "4.5", "9", "-1"]) {
			localStorage.setItem("emojiSkinTone", poisoned);
			expect(getSkinTone()).toBe(0);
		}
	});

	it("4a. picker DOM: flagged cell has a tone badge, unflagged does not, and badge swatch click resolves variant", async () => {
		assignTwoEmojiFixture();
		const pickPromise = Emoji.emojiPicker(10, -10);
		const picker = document.querySelector(".emojiPicker")!;
		expect(picker).not.toBeNull();

		const cells = picker.querySelectorAll(".emojiBody .emojiSelect");
		expect(cells).toHaveLength(2);

		const waveBadge = cells[0]!.querySelector(".emojiToneBadge");
		const grinBadge = cells[1]!.querySelector(".emojiToneBadge");
		expect(waveBadge).not.toBeNull();
		expect(grinBadge).toBeNull();

		waveBadge!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		const popup = document.querySelector(".emojiTonePopup")!;
		expect(popup).not.toBeNull();

		const swatches = popup.querySelectorAll(".emojiToneSwatch");
		expect(swatches).toHaveLength(6);
		expect(swatches[0]!.textContent).toBe("👋");
		expect(swatches[1]!.textContent).toBe("👋🏻");
		expect(swatches[2]!.textContent).toBe("👋🏼");
		expect(swatches[5]!.textContent).toBe("👋🏿");

		swatches[2]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		const picked = await pickPromise;
		expect(picked.emoji).toBe("👋🏼");
		expect(picked.name).toBe("waving hand");
	});

	it("4b. picker DOM: header selector sets default tone and re-renders body without closing; plain row click resolves default tone", async () => {
		assignTwoEmojiFixture();
		void Emoji.emojiPicker(10, -10);
		const picker = document.querySelector(".emojiPicker")!;

		const headerBtn = picker.querySelector(".emojiToneDefault");
		expect(headerBtn).not.toBeNull();

		headerBtn!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		const popup = document.querySelector(".emojiTonePopup")!;
		expect(popup).not.toBeNull();

		const swatches = popup.querySelectorAll(".emojiToneSwatch");
		expect(swatches).toHaveLength(6);

		// Pick tone 3 ("👋🏽")
		swatches[3]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		expect(localStorage.getItem("emojiSkinTone")).toBe("3");
		expect(getSkinTone()).toBe(3);

		// Picker stays open and body re-renders so the 👋 cell now shows 👋🏽
		expect(document.querySelector(".emojiPicker")).toBe(picker);
		expect(picker.classList.contains("removeElm")).toBe(false);
		const reRenderedCells = picker.querySelectorAll(".emojiBody .emojiSelect");
		expect(reRenderedCells[0]!.textContent).toBe("👋🏽");

		picker.remove();
		Contextmenu.declareMenu();

		// Plain row click on the flagged cell with tone 0 default resolves "👋"
		localStorage.removeItem("emojiSkinTone");
		const pickDefault0 = Emoji.emojiPicker(10, -10);
		const picker0 = document.querySelector(".emojiPicker")!;
		const cells0 = picker0.querySelectorAll(".emojiBody .emojiSelect");
		expect(cells0[0]!.textContent).toBe("👋");
		cells0[0]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		const resolved0 = await pickDefault0;
		expect(resolved0.emoji).toBe("👋");
		expect(resolved0.name).toBe("waving hand");
	});

	it("4c. picker DOM: footer shows :name: on row mouseover and clears on picker mouseleave", () => {
		assignTwoEmojiFixture();
		void Emoji.emojiPicker(10, -10);
		const picker = document.querySelector(".emojiPicker")!;

		const footer = picker.querySelector(".emojiFooter");
		expect(footer).not.toBeNull();

		const cells = picker.querySelectorAll(".emojiBody .emojiSelect");
		cells[1]!.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
		expect(footer!.textContent).toBe(":grinning:");

		picker.dispatchEvent(new MouseEvent("mouseleave"));
		expect(footer!.textContent).toBe("");
	});

	it("4d. picker DOM: badge hidden on a dual-tone row while 👋 in the same group still has one", () => {
		Emoji.emojis = [
			{
				name: "Test",
				emojis: [
					{
						name: "kiss woman, man",
						emoji: "👩\u200d❤️\u200d💋\u200d👨",
						skin_tone_support: true,
					},
					{name: "waving hand", emoji: "👋", skin_tone_support: true},
				],
			},
		];
		void Emoji.emojiPicker(10, -10);
		const picker = document.querySelector(".emojiPicker")!;
		const cells = picker.querySelectorAll(".emojiBody .emojiSelect");
		expect(cells).toHaveLength(2);
		expect(cells[0]!.querySelector(".emojiToneBadge")).toBeNull();
		expect(cells[1]!.querySelector(".emojiToneBadge")).not.toBeNull();
	});

	it("5. CSS var existence: every var(--x) in emoji tone/footer rule blocks is defined in themes.css", () => {
		const definedVars = new Set(
			Array.from(themesCss.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g), (m) => m[1]!),
		);
		for (const selector of [
			".emojiToneBadge",
			".emojiTonePopup",
			".emojiToneDefault",
			".emojiFooter",
		]) {
			const block = extractRuleBlock(styleCss, selector);
			expect(block.length, `${selector} rule block missing`).toBeGreaterThan(0);
			const vars = Array.from(block.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g), (m) => m[1]!);
			expect(vars.length, `${selector} has no var() tokens`).toBeGreaterThan(0);
			for (const token of vars) {
				expect(definedVars, `${selector} references undefined ${token}`).toContain(token);
			}
		}
	});
});
