import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {setTheme} = await import("./utils/utils");
const {Settings} = await import("./settings");

afterEach(() => {
	document.body.className = "";
});

// A pin, not red-first: the picker and the enum can only be proven together on the phone
// (the CSS itself has no behaviour to test).
it("setTheme applies the Onyx body class the picker writes", async () => {
	await setTheme("Onyx");

	expect(document.body.className).toBe("Onyx-theme");
});

it("Onyx is the default theme for fresh accounts", async () => {
	const {UserPreferences, ThemeOption} = await import("./utils/storage/userPreferences");

	expect(new UserPreferences().theme).toBe(ThemeOption.Onyx);
});

it("setTheme applies the Fuzzy body class the picker writes", async () => {
	await setTheme("Fuzzy");

	expect(document.body.className).toBe("Fuzzy-theme");
});

it("the theme picker offers Fuzzy", async () => {
	// The picker's list is a local array in showusersettings (localuser.ts), so it is read where
	// the settings tab builds it: the select the Themes tab adds, the one listing the themes.
	const options = Object.getPrototypeOf(new Settings("").addButton("probe"));
	const select = vi.spyOn(options, "addSelect");
	try {
		const hypo = {pronouns: "", bio: "", buildprofile: async () => document.createElement("div")};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			user: {pronouns: "", bio: {rawString: ""}, getpfpsrc: () => "", clone: () => hypo},
			updateProfile: () => {},
		});
		// The tabs after the profile may fail on this stub user; the themes tab is built before that.
		await localuser.showusersettings().catch(() => {});
		const themes = select.mock.calls
			.map((call) => call[2] as readonly string[])
			.find((list) => list.includes("Onyx"));

		expect(themes).toBeDefined();
		expect(themes).toContain("Fuzzy");
	} finally {
		select.mockRestore();
	}
});

it("the Fuzzy class computes Fuzzy's own variables, not the base's", async () => {
	// Loaded the way the app does it (index.html's <link href="/themes.css">): a fetch of the
	// URL would come back as Vite's JS module, not CSS.
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = "/themes.css";
	await new Promise((resolve, reject) => {
		link.onload = resolve;
		link.onerror = reject;
		document.head.append(link);
	});
	try {
		await setTheme("Fuzzy");
		const computed = getComputedStyle(document.body);

		// Neither value exists outside the Fuzzy block, so a missing block reads as "".
		expect(computed.getPropertyValue("--channel-selected").trim()).toBe("#121515");
		expect(computed.getPropertyValue("--link").trim()).toBe("#9ce6ff");
	} finally {
		link.remove();
	}
});
