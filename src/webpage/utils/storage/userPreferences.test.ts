import {afterEach, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../../localuser");
const {getPreferences, setPreferences, UserPreferences, ThemeOption} = await import(
	"./userPreferences.js"
);

afterEach(() => {
	localStorage.removeItem("userPreferences");
});

it("a malformed store reads as defaults instead of throwing", async () => {
	// i18n awaits getPreferences at module load: a corrupt store currently rejects there
	// and kills boot before any UI exists.
	localStorage.setItem("userPreferences", "{not json");
	await expect(getPreferences()).resolves.toBeInstanceOf(UserPreferences);
	// The claim is "defaults", not just "no throw": the theme must survive as its default.
	expect((await getPreferences()).theme).toBe(ThemeOption.Onyx);
});

it("a valid store survives the read", async () => {
	const prefs = new UserPreferences({theme: ThemeOption.Onyx, notificationVolume: 42});
	await setPreferences(prefs);
	const read = await getPreferences();
	expect(read.theme).toBe("Onyx");
	expect(read.notificationVolume).toBe(42);
});
