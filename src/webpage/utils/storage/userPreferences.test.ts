import {afterEach, expect, it, vi} from "vitest";

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
	// i18n awaits getPreferences at module load: a corrupt store used to reject there and
	// kill boot before any UI existed.
	const warn = vi.spyOn(console, "warn");
	localStorage.setItem("userPreferences", "{not json");
	await expect(getPreferences()).resolves.toBeInstanceOf(UserPreferences);
	// The degradation is loud: defaults win, but the console says the store was bad.
	expect(warn).toHaveBeenCalledWith(
		"userPreferences store is malformed, using defaults",
		expect.anything(),
	);
	// The claim is "defaults", not just "no throw": the theme must survive as its default.
	expect((await getPreferences()).theme).toBe(ThemeOption.Onyx);
	warn.mockRestore();
});

it("a valid store survives the read", async () => {
	// Light, not the Onyx default: a default-valued pin can't fail on a dropped field —
	// the constructor would refill it and the read would look faithful.
	const prefs = new UserPreferences({theme: ThemeOption.Light, notificationVolume: 42});
	await setPreferences(prefs);
	const read = await getPreferences();
	expect(read.theme).toBe(ThemeOption.Light);
	expect(read.notificationVolume).toBe(42);
});
