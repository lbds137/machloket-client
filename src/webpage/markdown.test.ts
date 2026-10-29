import {describe, expect, it, vi} from "vitest";
import type {Channel} from "./channel";
import type {Guild} from "./guild";

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
	it("the composer keeps the line break typed after a block", () => {
		expect(kept("```a```\nnext")).toBe("```a```\nnext");
	});
	it("a sent message still starts the next line right under the block", () => {
		const html = new MarkDown("```a```\nnext", undefined).makeHTML();
		const after = html.querySelector("pre")?.nextSibling;
		expect(after?.textContent).toBe("next");
	});
});

describe("MarkDown.relTime", () => {
	const DAY = 86_400_000;
	const fmt = () => new Intl.RelativeTimeFormat(I18n.locale, {style: "short"});

	it("labels by days up to a year, then years", () => {
		expect(MarkDown.relTime(new Date(Date.now() - 29 * DAY))).toBe(fmt().format(-29, "day"));
		expect(MarkDown.relTime(new Date(Date.now() - 60 * DAY))).toBe(fmt().format(-2, "month"));
		expect(MarkDown.relTime(new Date(Date.now() - 400 * DAY))).toBe(fmt().format(-1, "year"));
	});

	it("labels sub-second offsets as now", () => {
		expect(MarkDown.relTime(new Date(Date.now() + 200))).toBe(
			new Intl.RelativeTimeFormat(I18n.locale, {numeric: "auto"}).format(0, "second"),
		);
	});

	it("keeps a rendered <t:X:R> timestamp current", () => {
		vi.useFakeTimers();
		const host = document.createElement("div");
		document.body.append(host);
		try {
			const unix = Math.floor(Date.now() / 1000) - 50;
			host.append(new MarkDown(`<t:${unix}:R>`, undefined).makeHTML());
			vi.advanceTimersByTime(15_000);
			expect(host.querySelector(".markdown-timestamp")?.textContent).toBe(
				MarkDown.relTime(new Date(Date.now() - 65_000)),
			);
		} finally {
			host.remove();
			vi.useRealTimers();
		}
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

	it("turns 30 days into a month, and re-labels a past time as a year at 365 days, not later", () => {
		expect(MarkDown.relTime(new Date(Date.now() - 30 * DAY))).toBe(fmt().format(-1, "month"));
		const timeout = vi.spyOn(globalThis, "setTimeout");
		try {
			// 362 days ago reads "12 mo. ago"; the next whole month would be day 390.
			MarkDown.relTime(new Date(Date.now() - 362 * DAY), () => {});
			const delay = timeout.mock.calls.at(-1)![1] as number;
			expect(Math.abs(delay - 3 * DAY)).toBeLessThan(200);
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
		// Compared with plain text of the same length, each the best of 5 runs, so a busy test
		// run's pauses don't count (the quadratic scans took ~10-20x as long).
		const time = (txt: string) => {
			let best = Infinity;
			for (let k = 0; k < 5; k++) {
				const t0 = performance.now();
				render(txt);
				best = Math.min(best, performance.now() - t0);
			}
			return best;
		};
		render("[a](https://example.com) <:x:12345678901> <t:1>"); // warm up
		for (const txt of ["[".repeat(8000), "<:".repeat(4000), "<t:".repeat(2666)]) {
			const plain = Math.max(time("a".repeat(txt.length)), 2);
			expect(time(txt) / plain, JSON.stringify(txt.slice(0, 3))).toBeLessThan(4);
		}
	}, 20000); // ~2s of deliberate re-rendering; room for a loaded test run

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

describe("a mailto link's leaving dialog", () => {
	it("shows the address, not a blank host", () => {
		const a = document.createElement("a");
		MarkDown.safeLink(a, "mailto:lila@example.org");
		a.dispatchEvent(new MouseEvent("mouseup", {button: 0, bubbles: true}));

		try {
			// The dialog opened (a refused/no-op handler would fail here too).
			expect(document.querySelector(".background")).not.toBeNull();
			expect(document.body.textContent).toContain("lila@example.org");
		} finally {
			document.querySelectorAll(".background").forEach((e) => e.remove());
		}
	});
});

describe("a lone marker inside a formatting pair", () => {
	it("stays where it was typed in the composer", () => {
		// The box re-renders in keep mode on every keystroke, so a moved marker changes what's sent.
		expect(kept("**a*b**")).toBe("**a*b**");
		expect(kept("__my_var__")).toBe("__my_var__");
		expect(kept("~~a~b~~")).toBe("~~a~b~~");
		expect(kept("||a|b||")).toBe("||a|b||");
		expect(kept("***a**b***")).toBe("***a**b***");
	});

	it("renders italic nested inside bold around the right words", () => {
		const html = new MarkDown("**Note: *this* matters**", undefined).makeHTML();
		expect(html.querySelector("b")?.textContent).toBe("Note: this matters");
		expect(html.querySelector("b i, b em")?.textContent).toBe("this");
	});
});

describe("shortcode emoji", () => {
	it("still resolve once the emoji list loads, after a lookup made before it", () => {
		const loaded = MarkDown.emoji!.emojis;
		MarkDown._emojiMap = null;
		MarkDown.emoji!.emojis = [];
		try {
			// Rendering "at 12:30 or 13:00" looks up ":30 or 13:" before emoji.bin has arrived.
			expect(MarkDown.getEmoji("smile")).toBeUndefined();

			MarkDown.emoji!.emojis = [{name: "people", emojis: [{name: "smile", emoji: "😄"}]}];
			expect(MarkDown.getEmoji("smile")?.emoji).toBe("😄");
		} finally {
			MarkDown.emoji!.emojis = loaded;
			MarkDown._emojiMap = null;
		}
	});
});

describe("user mentions", () => {
	/** A message's text as drawn for a user whose friend "Ada" (id 123) is mentioned. */
	function drawn(txt: string) {
		const localuser = {
			user: {id: "me"},
			getUser: async (id: string) => (id === "123" ? {name: "Ada", bind: () => {}} : undefined),
		};
		return new MarkDown(txt, localuser as never).makeHTML();
	}

	it("the older nickname form <@!id> is a mention too", async () => {
		const html = drawn("hi <@!123>");

		await vi.waitFor(() => expect(html.querySelector(".mentionMD")?.textContent).toBe("@Ada"));
		expect(html.textContent).not.toContain("<@!");
	});

	it("<@> with no id stays text", () => {
		const html = drawn("hi <@>");

		expect(html.querySelector(".mentionMD")).toBeNull();
		expect(html.textContent).toBe("hi <@>");
	});
});

describe("the composer's text after a code block", () => {
	it("goes out with the line break typed after the block, once", () => {
		const box = document.createElement("div");
		box.append(new MarkDown("```a```\nnext", undefined, {keep: true}).makeHTML());

		expect(MarkDown.gatherBoxText(box)).toBe("```a```\nnext");
	});
});

describe("a line right after a code block", () => {
	it("can open a quote", () => {
		const html = new MarkDown("```a```\n> quoted", undefined).makeHTML();
		expect(html.querySelector(".quote")?.textContent).toBe("quoted");
	});
	it("can be a heading", () => {
		const html = new MarkDown("```a```\n# Title", undefined).makeHTML();
		expect(html.querySelector("h1")?.textContent).toBe("Title");
	});
});

describe("a quote or heading right after a code block", () => {
	it("draws no break before itself, since the block already ends its line", () => {
		for (const typed of ["```a```\n> q", "```a```\n>>> q", "```a```\n# T", "```a```\n-# s"]) {
			expect(new MarkDown(typed, undefined).makeHTML().querySelectorAll("br")).toHaveLength(0);
			const box = document.createElement("div");
			box.append(new MarkDown(typed, undefined, {keep: true}).makeHTML());
			expect(MarkDown.gatherBoxText(box)).toBe(typed);
		}
	});
	it("still breaks when text came between the block and the line", () => {
		expect(new MarkDown("```a```x`\n> q", undefined).makeHTML().querySelectorAll("br")).toHaveLength(1);
	});
});

describe("a line-start marker followed by a space", () => {
	it("still marks its line", () => {
		const draw = (typed: string) => new MarkDown(typed, undefined).makeHTML();
		expect(draw("> foo").querySelector(".quote")?.textContent).toBe("foo");
		expect(draw("# foo").querySelector("h1")?.textContent).toBe("foo");
		expect(draw("### foo").querySelector("h3")?.textContent).toBe("foo");
		expect(draw("-# foo").querySelector("small")?.textContent).toBe("foo");
	});
	it("previews apart from the line before it, and with no leading space", () => {
		const preview = (typed: string) =>
			new MarkDown(typed, undefined, {stdsize: true}).makeHTML().textContent;
		expect(preview("intro\n> q")).toBe("intro q");
		expect(preview("intro\n# T")).toBe("intro T");
		expect(preview("intro\n-# s")).toBe("intro s");
		expect(preview(">>> one")).toBe("one");
	});
});

describe("a line-start marker followed by a newline or tab", () => {
	it("stays as typed, in the message and from the composer", () => {
		for (const typed of [">\nfoo", "#\nfoo", "-#\nfoo", "##\tfoo", ">\tfoo"]) {
			const html = new MarkDown(typed, undefined).makeHTML();
			expect(html.querySelector(".quote, h1, h2, h3, small")).toBeNull();
			const box = document.createElement("div");
			box.append(new MarkDown(typed, undefined, {keep: true}).makeHTML());
			expect(MarkDown.gatherBoxText(box)).toBe(typed);
		}
	});
});

describe("a message that starts with a newline", () => {
	it("still marks its second line", () => {
		const draw = (typed: string) => new MarkDown(typed, undefined).makeHTML();
		expect(draw("\n> q").querySelector(".quote")?.textContent).toBe("q");
		expect(draw("\n# T").querySelector("h1")?.textContent).toBe("T");
		expect(draw("\n-# s").querySelector("small")?.textContent).toBe("s");
		expect(draw("\n>>> q").querySelector(".quote")?.textContent).toBe("q");
		expect(draw("\n\n> q").querySelector(".quote")?.textContent).toBe("q");
		expect(draw("\n* item").querySelector("li")?.textContent).toBe("item");
	});
	it("previews on one line without a leading space", () => {
		// The one-line preview joins lines with a space; with nothing before the first
		// marked line there is nothing to separate it from.
		const preview = (typed: string) =>
			new MarkDown(typed, undefined, {stdsize: true}).makeHTML().textContent;
		expect(preview("\n> q")).toBe("q");
		expect(preview("\n# T")).toBe("T");
		expect(preview("a\n> q")).toBe("a q");
		expect(preview("> a \n> b")).toBe("a b");
		expect(preview("\n\n> q")).toBe("q");
		// Plain lines take the same rule.
		expect(preview("\n\nx")).toBe("x");
		expect(preview("a\nb")).toBe("a b");
	});
	it("keeps its markers in the composer's round trip", () => {
		for (const typed of ["\n> q", "\n# T", "\n-# s", "\n>>> q", "\n* item"]) {
			const box = document.createElement("div");
			box.append(new MarkDown(typed, undefined, {keep: true}).makeHTML());
			expect(MarkDown.gatherBoxText(box)).toBe(typed);
		}
	});
});

describe("blank lines after a code block", () => {
	it("still show as a blank line", () => {
		const html = new MarkDown("```a```\n\nnext", undefined).makeHTML();
		expect(html.querySelectorAll("br")).toHaveLength(1);
	});
});

describe("lists and round trips after a code block", () => {
	it("a bullet list right after a block is a list, with no break before it", () => {
		const html = new MarkDown("```a```\n- item", undefined).makeHTML();
		expect(html.querySelector("ul li")?.textContent).toBe("item");
		expect(html.querySelector("br")).toBeNull();
	});
	it("the composer sends a quote after a block as typed", () => {
		const box = document.createElement("div");
		box.append(new MarkDown("```a```\n> q", undefined, {keep: true}).makeHTML());
		expect(MarkDown.gatherBoxText(box)).toBe("```a```\n> q");
	});
});

describe("a >>> block quote", () => {
	it("quotes every line after it, blank lines included", () => {
		const html = new MarkDown("intro\n>>> one\ntwo\n\nthree", undefined).makeHTML();
		const quotes = html.querySelectorAll(".quote");
		expect(quotes).toHaveLength(1);
		expect(quotes[0].textContent).toBe("onetwothree");
		expect(quotes[0].querySelectorAll("br")).toHaveLength(3);
		expect(html.textContent).toBe("introonetwothree");
	});
	it("is sent from the composer as typed", () => {
		const box = document.createElement("div");
		box.append(new MarkDown("intro\n>>> one\ntwo", undefined, {keep: true}).makeHTML());
		expect(MarkDown.gatherBoxText(box)).toBe("intro\n>>> one\ntwo");
	});
	it("opens at the start of a message, and round-trips blank lines from the composer", () => {
		expect(new MarkDown(">>> one", undefined).makeHTML().querySelector(".quote")?.textContent).toBe(
			"one",
		);
		const box = document.createElement("div");
		box.append(new MarkDown(">>> one\n\nthree", undefined, {keep: true}).makeHTML());
		expect(MarkDown.gatherBoxText(box)).toBe(">>> one\n\nthree");
	});
	it("needs a space after it: a newline or tab there stays as typed", () => {
		for (const typed of [">>>\nfoo", ">>>\tfoo"]) {
			expect(new MarkDown(typed, undefined).makeHTML().querySelector(".quote")).toBeNull();
			const box = document.createElement("div");
			box.append(new MarkDown(typed, undefined, {keep: true}).makeHTML());
			expect(MarkDown.gatherBoxText(box)).toBe(typed);
		}
	});
	it("previews as one line", () => {
		const html = new MarkDown(">>> one\ntwo", undefined, {stdsize: true}).makeHTML();
		expect(html.textContent).toBe("one two");
	});
	it("previews apart from the line before it", () => {
		const html = new MarkDown("intro\n>>> one", undefined, {stdsize: true}).makeHTML();
		expect(html.textContent).toBe("intro one");
	});
});

describe("a reply's one-line preview", () => {
	const preview = (txt: string) =>
		new MarkDown(txt, undefined, {stdsize: true}).makeHTML().textContent;

	it("keeps a masked link's words", () => {
		expect(preview("see [the docs](https://example.com/docs) first")).toBe("see the docs first");
	});
	it("keeps the words of separate lines apart", () => {
		expect(preview("line one\nline two")).toBe("line one line two");
	});
});

describe("a reply's one-line preview, more", () => {
	const draw = (txt: string) => new MarkDown(txt, undefined, {stdsize: true}).makeHTML();
	it("shows a masked link's words without a live link", () => {
		expect(
			draw("[docs](https://example.com/docs)").querySelector("a")?.getAttribute("href"),
		).toBeNull();
	});
	it("puts one space between lines, however many breaks", () => {
		expect(draw("a\n\nb").textContent).toBe("a b");
		expect(draw("a \nb").textContent).toBe("a b");
	});
});

describe("MarkDown with a Guild owner (member bios)", () => {
	const guildOwner = {
		info: {cdn: "http://cdn.test"},
		localuser: {user: {id: "me"}},
		roleids: new Map([["222", {id: "222", name: "Knights"}]]),
	} as unknown as Guild;

	it("a guild owner is not a channel", () => {
		expect(new MarkDown("hi", guildOwner).channel).toBeUndefined();
	});

	it("a guild owner is the guild; a localuser is no guild; a channel carries its own", () => {
		expect(new MarkDown("hi", guildOwner).guild).toBe(guildOwner);
		expect(new MarkDown("hi", undefined).guild).toBeUndefined();
		expect(
			new MarkDown("hi", {guild: guildOwner, localuser: {user: {id: "me"}}} as unknown as Channel)
				.guild,
		).toBe(guildOwner);
	});

	it("a role mention resolves against the guild's roles", () => {
		expect(new MarkDown("hi <@&222>", guildOwner).makeHTML().textContent).toContain("@Knights");
	});

	it("a role mention the guild lacks says so instead of vanishing", () => {
		expect(new MarkDown("hi <@&333>", guildOwner).makeHTML().textContent).toContain(
			I18n.guild.unknownRole(),
		);
	});

	it("a user mention resolves the member nickname against the guild", async () => {
		const owned = {
			info: {cdn: "http://cdn.test"},
			localuser: {user: {id: "me"}, getUser: () => ({name: "alice", bind: () => {}})},
			roleids: new Map(),
			resolveMember: () => Promise.resolve({name: "AliceInWonderland"}),
		} as unknown as Guild;
		const mention = new MarkDown("hi <@1553128655016763450>", owned).makeHTML().querySelector(".mentionMD")!;
		await vi.waitFor(() => expect(mention.textContent).toBe("@AliceInWonderland"));
	});
});
