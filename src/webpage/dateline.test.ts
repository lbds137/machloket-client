import {afterEach, describe, expect, it, vi} from "vitest";
await import("./localuser");
const {Message} = await import("./message");
const {Member} = await import("./member");
const {I18n} = await import("./i18n");
const {messageIn} = await import("./test/interactionFixture");

// generateMessage's dateline block is !dupe-gated, so these render with dupe=false and a
// pre-set .div — unlike the thinking fixture, which re-renders into an existing div.
function renderableChannel() {
	const {channel} = messageIn("@me");
	(channel.localuser as {user: unknown}).user = {id: "me"};
	// The !dupe render path builds the reactions row, which asks the infinite scroller
	// to pin to bottom; a no-op stands in for the real one.
	(channel as {infinite?: unknown}).infinite = {snapBottom: () => () => {}};
	return channel;
}

function messageAt(
	channel: unknown,
	id: string,
	when: Date,
): InstanceType<typeof Message> {
	return Object.assign(Object.create(Message.prototype), {
		id,
		flags: 0,
		author: {id: "author-" + id, username: "user" + id},
		owner: channel,
		headers: {},
		timestamp: when.toISOString(),
		content: {
			makeHTML: () => {
				const d = document.createElement("div");
				d.textContent = "body " + id;
				return d;
			},
			rawString: "body " + id,
			textContent: "body " + id,
			onUpdate: () => {},
		},
		reactions: [],
		embeds: [],
		attachments: [],
		stickers: [],
		edited_timestamp: null,
	}) as unknown as InstanceType<typeof Message>;
}

function render(message: InstanceType<typeof Message>, premessage?: InstanceType<typeof Message>) {
	message.div = document.createElement("div");
	return message.generateMessage(premessage, false, false) as HTMLDivElement;
}

const markerTexts = (div: HTMLDivElement, selector: string) =>
	[...div.querySelectorAll(selector)].map((m) => m.textContent?.trim() ?? "");

const formatted = (when: Date) =>
	Intl.DateTimeFormat(I18n.locale, {year: "numeric", month: "long", day: "numeric"}).format(when);

describe("message datelines", () => {
	it("draws no divider between same-day read messages", () => {
		const channel = renderableChannel();
		const div = render(
			messageAt(channel, "501", new Date(2026, 9, 8, 11, 0)),
			messageAt(channel, "500", new Date(2026, 9, 8, 10, 0)),
		);
		expect(div.querySelectorAll(".dateline")).toHaveLength(0);
	});

	it("draws a gray day divider only when the calendar day changes", () => {
		const channel = renderableChannel();
		const when = new Date(2026, 9, 8, 11, 0);
		const div = render(messageAt(channel, "501", when), messageAt(channel, "500", new Date(2026, 9, 7, 10, 0)));
		expect(markerTexts(div, ".dateline:not(.unreadDateline)")).toEqual([formatted(when)]);
		expect(div.querySelectorAll(".unreadDateline")).toHaveLength(0);
	});

	it("reads the day without a leading zero, as Discord does", () => {
		const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
		const lang = I18n.lang;
		I18n.lang = "en";
		try {
			const channel = renderableChannel();
			const div = render(
				messageAt(channel, "501", new Date(2026, 9, 8, 11, 0)),
				messageAt(channel, "500", new Date(2026, 9, 7, 10, 0)),
			);
			expect(markerTexts(div, ".dateline:not(.unreadDateline)")).toEqual(["October 8, 2026"]);
		} finally {
			I18n.lang = lang;
			languages.mockRestore();
		}
	});

	it("draws a divider for a week-long gap inside one month (same weekday)", () => {
		// The old comparison used getDay() (weekday): Oct 1 and Oct 8 2026 are both
		// Thursdays, so the divider silently never rendered.
		const channel = renderableChannel();
		const when = new Date(2026, 9, 8, 11, 0);
		const div = render(messageAt(channel, "501", when), messageAt(channel, "500", new Date(2026, 9, 1, 10, 0)));
		expect(markerTexts(div, ".dateline")).toEqual([formatted(when)]);
	});

	it("labels the first unread message NEW, without a date", () => {
		const channel = renderableChannel() as {lastreadmessageid?: string};
		const premessage = messageAt(channel, "500", new Date(2026, 9, 8, 10, 0));
		channel.lastreadmessageid = "500";
		const div = render(messageAt(channel, "501", new Date(2026, 9, 8, 11, 0)), premessage);
		// Discord's unread marker never carries the date — the live bug rendered a red
		// "September 27, 2026" line between two same-day messages.
		expect(markerTexts(div, ".unreadDateline")).toEqual(["NEW"]);
		expect(div.querySelectorAll(".dateline")).toHaveLength(1);
	});

	it("draws both the day divider and the NEW line when the first unread starts a day", () => {
		const channel = renderableChannel() as {lastreadmessageid?: string};
		const premessage = messageAt(channel, "500", new Date(2026, 9, 7, 10, 0));
		channel.lastreadmessageid = "500";
		const when = new Date(2026, 9, 8, 11, 0);
		const div = render(messageAt(channel, "501", when), premessage);
		expect(markerTexts(div, ".dateline:not(.unreadDateline)")).toEqual([formatted(when)]);
		expect(markerTexts(div, ".unreadDateline")).toEqual(["NEW"]);
	});
});

describe("message grouping", () => {
	afterEach(() => vi.restoreAllMocks());

	/** A plain message (type 0) by `author`, so it can join the previous one's group. */
	function byAuthor(channel: unknown, id: string, when: Date, author: object) {
		return Object.assign(messageAt(channel, id, when), {type: 0, author});
	}
	// What naming an author asks of them; the name itself comes from the member.
	const author = {
		id: "a1",
		buildpfp: () => document.createElement("img"),
		bind: () => {},
		subName: () => {},
		getCustomBadges: async () => [],
	};

	it("a new day starts a new group: the author is named under the day divider", () => {
		vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);
		const channel = renderableChannel();
		const div = render(
			byAuthor(channel, "501", new Date(2026, 9, 8, 0, 3), author),
			byAuthor(channel, "500", new Date(2026, 9, 7, 23, 58), author),
		);

		expect(div.querySelectorAll(".dateline")).toHaveLength(1);
		expect(div.querySelectorAll(".username")).toHaveLength(1);
	});

	// A pin, not red-first: within a day, a message minutes after the author's last joins it.
	it("the author's next message minutes later on the same day joins the group", () => {
		vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);
		const channel = renderableChannel();
		const div = render(
			byAuthor(channel, "501", new Date(2026, 9, 8, 10, 3), author),
			byAuthor(channel, "500", new Date(2026, 9, 8, 9, 58), author),
		);

		expect(div.querySelectorAll(".username")).toHaveLength(0);
	});

	/** A message whose whole text is `url`, with one embed of `type` for that url. */
	function linkWithEmbed(type: string) {
		vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);
		const url = "https://www.youtube.com/watch?v=abc";
		const channel = renderableChannel();
		const message = Object.assign(byAuthor(channel, "600", new Date(2026, 9, 8, 10, 0), author), {
			content: {
				makeHTML: () => Object.assign(document.createElement("div"), {textContent: url}),
				rawString: url,
				textContent: url,
				onUpdate: () => {},
			},
			embeds: [{json: {type, url}, generateHTML: () => document.createElement("div")}],
		});
		return render(message, messageAt(channel, "599", new Date(2026, 9, 8, 9, 0)));
	}

	it("a link with a video, article, link or rich card under it keeps its text, as on Discord", () => {
		for (const type of ["video", "article", "link", "rich"]) {
			expect(linkWithEmbed(type).textContent).toContain("youtube.com/watch");
		}
	});

	// A pin, not red-first: a link that is only an image shows the image alone.
	it("a link to an image or GIF shows the media alone", () => {
		expect(linkWithEmbed("image").textContent).not.toContain("youtube.com/watch");
		expect(linkWithEmbed("gifv").textContent).not.toContain("youtube.com/watch");
	});
});
