import {describe, expect, it} from "vitest";
await import("./localuser");
const {Message} = await import("./message");
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
	Intl.DateTimeFormat(I18n.lang, {year: "numeric", month: "long", day: "2-digit"}).format(when);

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
