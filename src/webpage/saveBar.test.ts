import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Options} = await import("./settings");

describe("settings save bar", () => {
	it("comes back for the next edit after switching tabs dismissed it", () => {
		// The settings window's tab buttons remove the bar the owner shows (Buttons.changed).
		const owner = {bar: undefined as HTMLElement | undefined, changed(div: HTMLElement) {
			this.bar = div;
			document.body.append(div);
		}};
		const options = Object.assign(Object.create(Options.prototype), {
			owner,
			noSubmit: false,
			haschanged: false,
		}) as InstanceType<typeof Options>;

		options.changed();
		owner.bar?.remove();
		owner.bar = undefined;
		options.changed();

		// Read through the object: TS narrowed `owner.bar` to undefined at the reset above.
		const shown = (owner as {bar?: HTMLElement}).bar;
		try {
			expect(shown?.isConnected).toBe(true);
		} finally {
			shown?.remove();
		}
	});
});
