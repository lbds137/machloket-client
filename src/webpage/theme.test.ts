import {afterEach, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {setTheme} = await import("./utils/utils");

afterEach(() => {
	document.body.className = "";
});

// A pin, not red-first: the picker and the enum can only be proven together on the phone
// (the CSS itself has no behaviour to test).
it("setTheme applies the Onyx body class the picker writes", async () => {
	await setTheme("Onyx");

	expect(document.body.className).toBe("Onyx-theme");
});
