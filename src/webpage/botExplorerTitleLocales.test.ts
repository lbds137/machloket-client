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
// still carry the old "Spacebar Explorer" string. getTranslation reads the locale file before
// en, so the stale string shadows the new English. translations.md says other locales fall back
// to en for missing keys, so each of these locales must give the English title.
describe("AUDIT B-F8: botExplorerTitle in the locales that still carry the old string", () => {
	it.each(["fr", "nl"])("%s shows the English title, not its stale translation", async (lang) => {
		await I18n.create("en");
		const english = I18n.getTranslation("botExplorerTitle");

		await I18n.create(lang);

		// The locale file itself must have loaded; otherwise this would test the English fallback.
		expect(I18n.lang).toBe(lang);
		expect(I18n.getTranslation("botExplorerTitle")).toBe(english);
	});

	// es is not selectable in the app today: its translations/es.json has no top-level
	// readableName, so vite's langs.js omits it and I18n.create("es") falls back to English
	// (filed separately). So this checks the shadowing on es's own data, layered over en the way
	// getTranslation layers a loaded locale.
	it("es's own file does not shadow the English title", async () => {
		await I18n.create("en");
		const english = I18n.getTranslation("botExplorerTitle");
		const es = (await (await fetch(new URL("./translations/es.json", import.meta.url).href)).json()) as unknown;

		I18n.translations = [es as never, ...I18n.translations];

		expect(I18n.getTranslation("botExplorerTitle")).toBe(english);
	});
});
