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

describe("a link url that doesn't parse", () => {
	it("leaves the element inert instead of throwing", () => {
		const a = document.createElement("a");
		expect(() => MarkDown.safeLink(a, "not a url")).not.toThrow();
		expect(a.getAttribute("href")).toBeNull();
		expect(a.onmouseup).toBeNull();
	});

	it("doesn't stop a bot's rich embed from rendering", async () => {
		const {Embed} = await import("./embed");
		type Args = ConstructorParameters<typeof Embed>;
		const embed = new Embed(
			{type: "rich", author: {name: "bot", url: "not a url"}} as Args[0],
			{} as Args[1],
		);
		const html = embed.generateHTML();
		expect(html.querySelector(".username")?.textContent).toBe("bot");
	});
});

describe("parsing hostile or nested input", () => {
	const render = (txt: string) => new MarkDown(txt, undefined).makeHTML();

	it("still reads masked links and timestamps", () => {
		const link = render("see [docs](https://example.com/a) after").querySelector("a");
		expect(link?.textContent).toBe("docs");
		expect(link?.title).toContain("https://example.com/a");
		expect(render("[x](<https://example.com/b>)").querySelector("a")?.textContent).toBe("x");
		expect(render("[no] (https://example.com/c)").querySelector("a")?.textContent).not.toBe("no");
		const time = render("at <t:0:d> ok").textContent ?? "";
		expect(time).not.toContain("<t:");
		expect(time.endsWith(" ok")).toBe(true);
		expect(render("<t:12345678901234567:d>").textContent).toBe("<t:12345678901234567:d>");
		// The longest valid timestamp still fits the bounded look-ahead.
		expect(render("<t:0000000000000001:R>").textContent).not.toContain("<t:");
	});

	it("doesn't re-scan to the end of the message for every unmatched [ or <:", () => {
		// Compared with plain text of the same length rendered just before, so a busy test run
		// slows both alike (the quadratic scans took ~20x as long).
		const time = (txt: string) => {
			const t0 = performance.now();
			render(txt);
			return performance.now() - t0;
		};
		render("[a](https://example.com) <:x:12345678901> <t:1>"); // warm up
		for (const txt of ["[".repeat(4000), "<:".repeat(2000), "<t:".repeat(1333)]) {
			const plain = Math.max(time("a".repeat(txt.length)), 5);
			expect(time(txt) / plain, JSON.stringify(txt.slice(0, 3))).toBeLessThan(6);
		}
	});

	it("renders a :word: before the emoji list has loaded", () => {
		const emoji = MarkDown.emoji!;
		const loaded = emoji.emojis;
		const cached = MarkDown._emojiMap;
		emoji.emojis = undefined as unknown as typeof loaded;
		MarkDown._emojiMap = null;
		try {
			expect(render("hi :smile: and <t:0:d>").textContent).toContain(":smile:");
		} finally {
			emoji.emojis = loaded;
			MarkDown._emojiMap = cached;
		}
	});

	it("shows a quote or heading line whose content fails to render as its text, not nothing", () => {
		const original = MarkDown.prototype.markdown;
		const spy = vi.spyOn(MarkDown.prototype, "markdown").mockImplementation(function (this: InstanceType<typeof MarkDown>, txt, opts) {
			if (txt === "boom") throw new Error("render failed");
			return original.call(this, txt, opts);
		});
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const html = render("first\n> boom\nlast");
			expect(html.textContent).toContain("boom");
			expect(html.textContent).toContain("last");
			expect(logged).toHaveBeenCalled();
		} finally {
			spy.mockRestore();
			logged.mockRestore();
		}
	});
});
