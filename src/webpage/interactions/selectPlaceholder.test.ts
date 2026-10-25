import {describe, expect, it} from "vitest";
import {dmMessage} from "../test/interactionFixture";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first); the fixture loads localuser first.
const {Components} = await import("./compontents");

/** Renders a message-components row and returns its single select's box. */
function selectBox(comp: {
	type: 3;
	custom_id: string;
	placeholder?: string;
	options: {label: string; value: string}[];
}) {
	const {message} = dmMessage();
	const [select] = new Components([comp], message).components as unknown as [
		{getHTML: () => HTMLElement},
	];
	return select.getHTML().querySelector("input")!;
}

describe("a select's placeholder rides the wire", () => {
	it("shows in the box while nothing is chosen", () => {
		const box = selectBox({
			type: 3,
			custom_id: "pick",
			placeholder: "Pick one",
			options: [{label: "Large", value: "l"}],
		});

		expect(box.placeholder).toBe("Pick one");
	});

	it("leaves the box blank when the bot sent none", () => {
		const box = selectBox({
			type: 3,
			custom_id: "pick",
			options: [{label: "Large", value: "l"}],
		});

		expect(box.placeholder).toBe("");
	});
});
