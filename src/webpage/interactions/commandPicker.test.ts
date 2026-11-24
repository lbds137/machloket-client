import {afterEach, describe, expect, it} from "vitest";
import {clockIcon} from "./commandPicker";

// Under the deployed Trusted Types policy (utils/trustedTypes.ts) a markup string reaching
// innerHTML is refused, so the picker's own icon is built with DOM calls. The trap makes any
// markup-parsing setter throw, as the browser does under the policy.
describe("clockIcon", () => {
	const original = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
	afterEach(() => {
		Object.defineProperty(Element.prototype, "innerHTML", original);
	});

	it("draws the Frequently Used clock without parsing markup", () => {
		Object.defineProperty(Element.prototype, "innerHTML", {
			...original,
			set(value: string) {
				if (value !== "") throw new TypeError("markup reached innerHTML");
				original.set!.call(this, value);
			},
		});
		const icon = clockIcon();
		const svg = icon.querySelector("svg");
		expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
		expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(svg?.getAttribute("width")).toBe("24");
		expect(svg?.getAttribute("height")).toBe("24");
		const circle = svg?.querySelector("circle");
		expect(circle?.namespaceURI).toBe("http://www.w3.org/2000/svg");
		expect(
			["cx", "cy", "r", "fill", "stroke", "stroke-width"].map((a) => circle?.getAttribute(a)),
		).toEqual(["12", "12", "9", "none", "currentColor", "2"]);
		const path = svg?.querySelector("path");
		expect(
			["d", "fill", "stroke", "stroke-width", "stroke-linecap"].map((a) => path?.getAttribute(a)),
		).toEqual(["M12 7v5l3 2", "none", "currentColor", "2", "round"]);
	});
});
