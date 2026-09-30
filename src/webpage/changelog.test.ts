import {describe, expect, it} from "vitest";
// The app's modules import each other in cycles that only evaluate in the entry's order.
await import("./localuser");
const {resolveChangelogImageSrc} = await import("./changelog");

describe("changelog image paths", () => {
	it("resolves bundled images origin-relative, never to the module's origin", () => {
		// The old import.meta.url resolution absolutized to whichever origin served the
		// module (http://localhost:8080/... in dev) — broken on every other origin.
		expect(resolveChangelogImageSrc("./changelog/2-translate.webp")).toBe(
			"/changelog/2-translate.webp",
		);
	});

	it("keeps absolute and root-relative paths as written", () => {
		expect(resolveChangelogImageSrc("/logo.svg")).toBe("/logo.svg");
		expect(resolveChangelogImageSrc("https://example.com/img.png")).toBe(
			"https://example.com/img.png",
		);
	});
});
