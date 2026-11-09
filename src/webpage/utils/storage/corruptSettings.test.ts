import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../../localuser");
const {DeveloperSettings, getDeveloperSettings} = await import("./devSettings.js");
const {getLocalSettings, LocalSettings} = await import("./localSettings.js");
const {MarkDown} = await import("../../markdown.js");

// These readers run at module load (MarkDown.trustedDomains, and the developer and local
// settings migrations): a corrupt stored value must read as defaults, not throw.
const CORRUPT = ["{not json", "null", '"a string"', "42", "{}"];

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe.each(CORRUPT)("stored value %s", (stored) => {
	it("trusted link domains read as the defaults", () => {
		localStorage.setItem("trustedDomains", stored);
		expect([...MarkDown.getTrusted()]).toEqual([location.host, "*.sbar.fyi"]);
	});
});

it("trusted link domains keep the stored strings and drop anything else", () => {
	localStorage.setItem(
		"trustedDomains",
		JSON.stringify(["a.example.test", 7, null, "b.example.test"]),
	);
	expect([...MarkDown.getTrusted()]).toEqual(["a.example.test", "b.example.test"]);
});

it.each(["{not json", "[1,2]", '"a string"', "null", "42"])(
	"developer and local settings stored as %s read as defaults",
	(stored) => {
		localStorage.setItem("developerSettings", stored);
		localStorage.setItem("localSettings", stored);
		expect({...getDeveloperSettings()}).toEqual({...new DeveloperSettings()});
		expect({...getLocalSettings()}).toEqual({...new LocalSettings()});
	},
);
