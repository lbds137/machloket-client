import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {File} = await import("./file");

it("draws a file card's icon as an SVG, not a character phones lack", () => {
	// "🗎" (U+1F5CE) isn't in Android's emoji font: the phone showed "?".
	const file = new File(
		{
			id: "1",
			filename: "notes.pdf",
			content_type: "application/pdf",
			size: 2048,
			url: "http://cdn.test/notes.pdf",
		} as never,
		null,
	);

	const card = file.createunknown();

	const icon = card.querySelector(".fileicon")!;
	expect(icon.textContent).toBe("");
	expect(icon.querySelector(".svgicon.svg-file")).not.toBeNull();
});
