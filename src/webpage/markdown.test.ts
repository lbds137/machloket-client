import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MarkDown} = await import("./markdown");
const {I18n} = await import("./i18n");
await I18n.done;

/** The composer's view of a draft: keep mode renders the markers so the box text round-trips. */
const kept = (txt: string) => new MarkDown(txt, undefined, {keep: true}).makeHTML().textContent;

describe("bullet lists in the composer (keep mode)", () => {
	it("keep the inline markers inside a bullet line", () => {
		// A bullet line lost its ** in the box, so what was sent changed under the user.
		expect(kept("- **hi** there")).toBe("- **hi** there");
		expect(kept("* _a_ `b`")).toBe("* _a_ `b`");
	});

	it("still render the formatting in a sent message", () => {
		const html = new MarkDown("- **hi** there", undefined).makeHTML();
		expect(html.querySelector("li b, li strong")?.textContent).toBe("hi");
	});
});

describe("triple-backtick code", () => {
	const code = (txt: string) =>
		new MarkDown(txt, undefined).makeHTML().querySelector("pre")?.textContent;
	it("a single line keeps all its words (the language tag needs a newline)", () => {
		expect(code("```hello```")).toBe("hello");
		expect(code("```hello world```")).toBe("hello world");
	});
	it("a language tag on its own line is still dropped", () => {
		expect(code("```js\nlet a = 1;```")).toBe("let a = 1;");
	});
	it("the composer keeps the source as typed", () => {
		expect(kept("```hello world```")).toBe("```hello world```");
		expect(kept("```js\nlet a```")).toBe("```js\nlet a```");
	});
});

describe("MarkDown.relTime", () => {
	const DAY = 86_400_000;
	const fmt = () => new Intl.RelativeTimeFormat(I18n.lang, {style: "short"});

	it("labels by days up to a year, then years", () => {
		expect(MarkDown.relTime(new Date(Date.now() - 30 * DAY))).toBe(fmt().format(-30, "day"));
		expect(MarkDown.relTime(new Date(Date.now() - 400 * DAY))).toBe(fmt().format(-1, "year"));
	});

	it("schedules the next label change inside setTimeout's range, at the right edge", () => {
		const timeout = vi.spyOn(globalThis, "setTimeout");
		const delay = () => timeout.mock.calls.at(-1)![1] as number;
		try {
			for (const date of [new Date(Date.now() - 30 * DAY), new Date(Date.now() + 30 * DAY)]) {
				MarkDown.relTime(date, () => {});
				expect(delay()).toBeGreaterThanOrEqual(1000);
				expect(delay()).toBeLessThanOrEqual(2 ** 31 - 1);
			}
			// 5m20s ago reads "5 min. ago" until 6m, 40s on; 5m20s ahead reads "in 5 min."
			// until under 5m, 20s on.
			MarkDown.relTime(new Date(Date.now() - 320_000), () => {});
			expect(Math.abs(delay() - 40_000)).toBeLessThan(200);
			MarkDown.relTime(new Date(Date.now() + 320_000), () => {});
			expect(Math.abs(delay() - 20_000)).toBeLessThan(200);
		} finally {
			timeout.mockRestore();
		}
	});
});
