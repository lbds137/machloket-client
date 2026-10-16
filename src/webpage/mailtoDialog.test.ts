import {afterEach, describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MarkDown} = await import("./markdown");
const {I18n} = await import("./i18n");
await I18n.done;

/** Clicks a link built by safeLink and returns the text of the leaving dialog it opens. */
function dialogTextFor(href: string) {
	const a = document.createElement("a");
	MarkDown.safeLink(a, href);
	a.dispatchEvent(new MouseEvent("mouseup", {button: 0, bubbles: true}));
	return document.querySelector(".background")?.textContent ?? "(no dialog)";
}

afterEach(() => {
	document.querySelectorAll(".background").forEach((e) => e.remove());
});

// AUDIT B-F7 (introduced by 51769139): the leaving dialog for a mailto shows Url.host or, with no
// host, Url.pathname raw. An RFC 6068 `mailto:?to=` link has no pathname, so the dialog is blank;
// a percent-encoded address shows its %40 as typed.
describe("AUDIT B-F7: the mailto leaving dialog names the address", () => {
	it("a mailto with only a to= query names the address", () => {
		const text = dialogTextFor("mailto:?to=a@b.c");

		expect(text).toContain("a@b.c");
	});

	it("a percent-encoded address reads decoded", () => {
		const text = dialogTextFor("mailto:foo%40bar.com");

		expect(text).toContain("foo@bar.com");
	});

	// RFC 6068 hfnames are case-insensitive, so TO= is the same header as to=.
	it("an upper-case TO= query still names the address", () => {
		const text = dialogTextFor("mailto:?TO=a@b.c");

		expect(text).toContain("a@b.c");
	});
});
