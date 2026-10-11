import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(async () => {
	vi.unstubAllGlobals();
	await I18n.create("en");
});

// AUDIT B-F8 (introduced by b0e39bb5): en.json's botExplorerTitle was retitled, but fr, es and nl
// still carried the old "Spacebar Explorer" string. getTranslation reads the locale file before
// en, so the stale string shadowed the new English. fr and nl still fall back to en (their keys
// are dropped); es was finished under B-F10's ruling and now carries its own translation — the
// bug shape to keep dead is the stale "Spacebar Explorer" title, not "must equal English".
describe("AUDIT B-F8: botExplorerTitle in the locales that still carry the old string", () => {
	it.each(["fr", "nl"])("%s shows the English title, not its stale translation", async (lang) => {
		await I18n.create("en");
		const english = I18n.getTranslation("botExplorerTitle");

		await I18n.create(lang);

		// The locale file itself must have loaded; otherwise this would test the English fallback.
		expect(I18n.lang).toBe(lang);
		expect(I18n.getTranslation("botExplorerTitle")).toBe(english);
	});

	it("es is selectable and shows its own title, never the stale one", async () => {
		await I18n.create("es");

		expect(I18n.lang).toBe("es");
		const title = I18n.getTranslation("botExplorerTitle");
		expect(title).not.toContain("Spacebar Explorer");
		expect(title).not.toBe("Explorador de Spacebar");
	});
});
