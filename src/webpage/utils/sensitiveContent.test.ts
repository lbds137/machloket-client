import {beforeEach, expect, it} from "vitest";
import {get, getSensitiveContent, set, setSensitiveContent} from "./sensitiveContent";

beforeEach(() => {
	localStorage.clear();
});

it("defaults both sources to blur when nothing is stored", async () => {
	expect(await getSensitiveContent()).toEqual({spoilers: "blur", nsfw: "blur"});
});

it("stores its state in the userPreferences store's spoilerAction and nsfwAction fields", async () => {
	await setSensitiveContent({spoilers: "blur"});
	const stored = JSON.parse(localStorage.getItem("userPreferences") || "{}") as Record<
		string,
		unknown
	>;
	expect(stored.spoilerAction).toBe("blur");
	expect(stored.nsfwAction).toBe("blur");

	await set({nsfw: "block"});
	const restored = JSON.parse(localStorage.getItem("userPreferences") || "{}") as Record<
		string,
		unknown
	>;
	expect(restored.nsfwAction).toBe("block");
	expect(await get()).toEqual({spoilers: "blur", nsfw: "block"});
});

it("falls back to defaults when stored prefs are malformed or carry unknown values", async () => {
	localStorage.setItem("userPreferences", "{not-valid-json");
	expect(await getSensitiveContent()).toEqual({spoilers: "blur", nsfw: "blur"});

	localStorage.setItem(
		"userPreferences",
		JSON.stringify({spoilerAction: "invalid", nsfwAction: "blur"}),
	);
	expect(await getSensitiveContent()).toEqual({spoilers: "blur", nsfw: "blur"});
});
