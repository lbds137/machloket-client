import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Options} = await import("./settings");
await (
	await import("./i18n")
).I18n.done;

const API = "http://mute.test/api/v9";

describe("unmuting a channel", () => {
	it("keeps the channel's notification level, not its unread-mention count", async () => {
		const sent = captureRequests(API + "/users/@me/guilds/g1/settings", () => Response.json({}));
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			// `guild` is the owner.
			owner: {id: "g1", info: {api: API}, unreads: () => {}},
			headers: {},
			mentions: 5,
			message_notifications: 1,
			unreads: () => {},
		}) as InstanceType<typeof Channel>;

		channel.unmuteChannel();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({channel_overrides: {c1: {message_notifications: 1, muted: false}}});
	});
});

const DAY = 24 * 3600 * 1000;

/** A sidebar channel muted until `end_time`, its row drawn (a row with nothing below it). */
function mutedChannel(end_time: number | string) {
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {id: "100", info: {api: API}, unreads() {}},
		headers: {},
		children: [],
		mute_config: {selected_time_window: 0, end_time},
		unreads() {},
	}) as InstanceType<typeof Channel>;
	Object.defineProperty(channel, "visible", {get: () => false});
	const row = () => channel.createguildHTML();
	return {channel, row};
}

describe("a muted channel's row", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({})));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
	});
	it("a mute longer than a timer can wait still shows until it ends", () => {
		const {row} = mutedChannel(Date.now() + 30 * DAY);
		const div = row();

		vi.advanceTimersByTime(25 * DAY); // past setTimeout's ~24.8-day ceiling
		expect(div.classList.contains("muted")).toBe(true);

		vi.advanceTimersByTime(5 * DAY + 1000);
		expect(div.classList.contains("muted")).toBe(false);
	});

	it("a mute renewed before it ran out isn't ended by the earlier one's timer", () => {
		const {channel, row} = mutedChannel(Date.now() + 3600 * 1000);
		row();
		channel.mute_config = {selected_time_window: 0, end_time: Date.now() + DAY};
		const div = row(); // the row redrawn for the renewed mute

		vi.advanceTimersByTime(2 * 3600 * 1000);
		expect(div.classList.contains("muted")).toBe(true);
	});

	it("a mute end sent as a date string (Discord's shape; Spacebar sends ms) shows until it ends", () => {
		const {row} = mutedChannel(new Date(Date.now() + 3600 * 1000).toISOString());
		const div = row();

		vi.advanceTimersByTime(1000);
		expect(div.classList.contains("muted")).toBe(true);
		vi.advanceTimersByTime(3600 * 1000);
		expect(div.classList.contains("muted")).toBe(false);
	});

	it("a mute set from the menu ends on time", () => {
		const {channel, row} = mutedChannel(0);
		const div = row();
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");

		channel.muteChannel(); // the 30-minute default
		expect(buttons).toHaveBeenCalledTimes(1); // the dialog's one button: submit
		(buttons.mock.calls[0][2] as () => void)();
		expect(div.classList.contains("muted")).toBe(true);

		vi.advanceTimersByTime(31 * 60 * 1000);
		expect(div.classList.contains("muted")).toBe(false);
	});

	it("unmuting shows at once, and the mute's timer doesn't act later", () => {
		const {channel, row} = mutedChannel(Date.now() + 3600 * 1000);
		const div = row();
		const shown = vi.spyOn(div.classList, "toggle");

		channel.unmuteChannel();
		expect(div.classList.contains("muted")).toBe(false);

		shown.mockClear();
		vi.advanceTimersByTime(2 * 3600 * 1000);
		expect(shown).not.toHaveBeenCalled();
	});
});
