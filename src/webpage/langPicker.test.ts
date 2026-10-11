import {describe, expect, it} from "vitest";
// @ts-ignore langs.js is generated at vite buildStart and has no declaration file (same import as i18n.ts)
import {langs} from "./translations/langs.js";

// langs.js is generated at vite buildStart from each translations/*.json's top-level readableName
// (vite.config.js generateLangs). A locale without one is dropped from the language picker
// silently, so these pins fail when a locale that should be offered loses its readableName.
describe("language picker", () => {
	it.each(["es.json", "cs.json"])("offers %s with a non-empty readable name", (file) => {
		expect(Object.keys(langs)).toContain(file);
		expect(typeof langs[file]).toBe("string");
		expect(langs[file].length).toBeGreaterThan(0);
	});

	it("keeps lfn.json out of the picker (owner ruling: lfn stays as it is)", () => {
		expect(Object.keys(langs)).not.toContain("lfn.json");
	});
});
