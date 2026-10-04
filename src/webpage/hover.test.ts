import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {Hover} = await import("./hover");

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll(".hoverthing").forEach((e) => e.remove());
});

describe("hover tooltips", () => {
	it("binding the same element twice (a re-render) pops no alert", () => {
		const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
		const elm = document.createElement("span");
		document.body.append(elm);

		new Hover("one").addEvent(elm);
		new Hover("two").addEvent(elm);

		expect(alertSpy).not.toHaveBeenCalled();
		elm.remove();
	});
});
