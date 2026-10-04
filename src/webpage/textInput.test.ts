import {describe, expect, it} from "vitest";

await import("./localuser");
const {Options} = await import("./settings");

describe("a channel-name field (spaces become dashes)", () => {
	it("a pasted name with spaces is stored with dashes, no keyup needed", () => {
		const owner = Object.assign(Object.create(Options.prototype), {
			options: [],
			html: new WeakMap(),
			changed: () => {},
			generate: () => {},
		}) as InstanceType<typeof Options>;
		const field = owner.addTextInput("Name", () => {}, {spaceReplace: "-"});
		const input = field.generateHTML().querySelector("input")!;

		input.value = "game night";
		input.dispatchEvent(new Event("input"));

		expect(field.value).toBe("game-night");
		expect(input.value).toBe("game-night");
	});
});
