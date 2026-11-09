import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first). Loading it runs setDefaults once, as boot does.
await import("../localuser");
const {setDefaults} = await import("./utils.js");

afterEach(() => {
	vi.restoreAllMocks();
});

it("leaves a userinfos that already has its defaults unwritten", () => {
	// setDefaults runs on every page load: rewriting an unchanged store is a write a full
	// localStorage refuses, for nothing.
	const setItem = vi.spyOn(Storage.prototype, "setItem");
	setDefaults();
	expect(setItem.mock.calls.filter(([key]) => key === "userinfos")).toEqual([]);
});

it("replaces a userinfos that isn't an object with the defaults", () => {
	// A stray `false` used to get the defaults; it must not reach `userinfos.users = {}`,
	// which throws on a primitive and stops the app booting.
	const stored = localStorage.getItem("userinfos");
	localStorage.setItem("userinfos", "false");
	try {
		expect(() => setDefaults()).not.toThrow();
		expect(JSON.parse(localStorage.getItem("userinfos")!)).toMatchObject({users: {}});
	} finally {
		if (stored !== null) localStorage.setItem("userinfos", stored);
		else localStorage.removeItem("userinfos");
	}
});

it("doesn't throw when a full store refuses the first userinfos", () => {
	const stored = localStorage.getItem("userinfos");
	localStorage.removeItem("userinfos");
	const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota;
	});
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		expect(() => setDefaults()).not.toThrow();
		// The refusal is logged, not swallowed.
		expect(error).toHaveBeenCalledWith(quota);
	} finally {
		vi.restoreAllMocks();
		if (stored !== null) localStorage.setItem("userinfos", stored);
	}
});

it("boots past an unparseable userinfos without overwriting it", () => {
	// setDefaults runs at module load: a throw stops the app booting. The value holds the
	// signed-in accounts, so it stays as found rather than being replaced by the defaults.
	const stored = localStorage.getItem("userinfos");
	localStorage.setItem("userinfos", "{bad");
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		expect(() => setDefaults()).not.toThrow();
		expect(localStorage.getItem("userinfos")).toBe("{bad");
		expect(warn).toHaveBeenCalledWith(
			"userinfos store is malformed, leaving it as found",
			expect.any(SyntaxError),
		);
	} finally {
		if (stored !== null) localStorage.setItem("userinfos", stored);
		else localStorage.removeItem("userinfos");
	}
});
