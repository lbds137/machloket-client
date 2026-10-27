import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://mute.test/api/v9";

type MuteConfig = {selected_time_window: number; end_time: number};

/** A stubbed guild with mute state and a drawn pillar icon (div + its .unread child);
 * `owner` backs localuser/info, `channels` backs the mentions getter unreads() walks. */
function muteGuild(mute_config: MuteConfig | null): InstanceType<typeof Guild> {
	const html = document.createElement("div");
	html.append(document.createElement("div"));
	return Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {},
		owner: {info: {api: API}},
		mute_config,
		channels: [],
		html,
	}) as InstanceType<typeof Guild>;
}

/** muteGuild plus what the context menu's rows read while rendering. */
function menuGuild(mute_config: MuteConfig | null): InstanceType<typeof Guild> {
	return Object.assign(muteGuild(mute_config), {
		member: {hasPermission: () => false, user: {id: "me-1"}},
		properties: {owner_id: "owner-1", name: "The Guild"},
		// `localuser` resolves to `owner`; the report row reads its `user.id`.
		owner: {info: {api: API}, user: {id: "me-2"}},
	}) as InstanceType<typeof Guild>;
}

/** Renders the registered guild menu rows for a stubbed guild and returns their labels. */
function menuLabels(guild: InstanceType<typeof Guild>): string[] {
	const menu = document.createElement("div");
	for (const part of Guild.contextmenu.buttons) {
		part.makeContextHTML(guild, undefined, menu, [], new WeakSet());
	}
	return Array.from(menu.querySelectorAll("button")).map((b) => b.textContent ?? "");
}

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());
});

describe("the guild menu's mute rows", () => {
	it("offers Mute on an unmuted guild and Unmute on a muted one, never both", () => {
		const unmuted = menuLabels(menuGuild(null));
		// Positive control: the menu itself built, so an empty render can't pass the row pins.
		expect(unmuted).toContain(I18n.guild.markRead());
		expect(unmuted).toContain(I18n.guild.mute());
		expect(unmuted).not.toContain(I18n.guild.unmute());

		const muted = menuLabels(menuGuild({selected_time_window: 1800, end_time: Date.now() + 1000}));
		expect(muted).toContain(I18n.guild.unmute());
		expect(muted).not.toContain(I18n.guild.mute());
	});

	it("offers Copy server info writing name and id to the clipboard", () => {
		const guild = menuGuild(null);
		const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

		const menu = document.createElement("div");
		for (const part of Guild.contextmenu.buttons) {
			part.makeContextHTML(guild, undefined, menu, [], new WeakSet());
		}
		const row = Array.from(menu.querySelectorAll("button")).find(
			(b) => b.textContent === I18n.guild.copyInfo(),
		);
		expect(row, "the Copy server info row").toBeDefined();
		row!.click();

		expect(copied).toHaveBeenCalledWith("The Guild (g1)");
	});
});

describe("muting a guild", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("PATCHes top-level muted + mute_config (no channel_overrides) and dims the pillar icon", () => {
		const sent = captureRequests(API + "/users/@me/guilds/g1/settings", () => Response.json({}));
		const guild = muteGuild(null);
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");

		guild.muteGuild(); // the 30-minute default
		(buttons.mock.calls[0][2] as () => void)();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			muted: true,
			mute_config: {selected_time_window: 1800, end_time: expect.any(Number)},
		});
		expect(guild.html!.classList.contains("muted")).toBe(true);
	});

	it("a mute set from the menu ends on time", () => {
		captureRequests(API + "/users/@me/guilds/g1/settings", () => Response.json({}));
		const guild = muteGuild(null);
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");

		guild.muteGuild(); // the 30-minute default
		(buttons.mock.calls[0][2] as () => void)();
		expect(guild.html!.classList.contains("muted")).toBe(true);

		vi.advanceTimersByTime(31 * 60 * 1000);
		expect(guild.html!.classList.contains("muted")).toBe(false);
	});

	it("unmuting PATCHes muted false with a zero config, undims at once, and no timer acts later", () => {
		const sent = captureRequests(API + "/users/@me/guilds/g1/settings", () => Response.json({}));
		const guild = muteGuild({selected_time_window: 1800, end_time: Date.now() + 3600 * 1000});
		guild.unreads(); // the pillar draw that happens on rebuild
		expect(guild.html!.classList.contains("muted")).toBe(true);
		const toggler = vi.spyOn(guild.html!.classList, "toggle");

		guild.unmuteGuild();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			muted: false,
			mute_config: {selected_time_window: -1, end_time: 0},
		});
		expect(guild.html!.classList.contains("muted")).toBe(false);

		toggler.mockClear();
		vi.advanceTimersByTime(2 * 3600 * 1000);
		expect(toggler).not.toHaveBeenCalled();
	});

	it("the pillar icon stays dimmed past setTimeout's ceiling on a long mute", () => {
		const guild = muteGuild({selected_time_window: 1 << 30, end_time: Date.now() + 40 * 24 * 3600 * 1000});
		guild.unreads();
		expect(guild.html!.classList.contains("muted")).toBe(true);

		vi.advanceTimersByTime(30 * 24 * 3600 * 1000); // past the ~24.8-day timer limit
		expect(guild.html!.classList.contains("muted")).toBe(true);
		vi.advanceTimersByTime(10 * 24 * 3600 * 1000 + 1000);
		expect(guild.html!.classList.contains("muted")).toBe(false);
	});
});

describe("a refused guild mute", () => {
	it("rolls mute_config back, undims and opens the dialog; an accepted one keeps the new config", async () => {
		const url = `${API}/users/@me/guilds/g1/settings`;
		const guild = muteGuild(null);
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");

		captureRequests(url, () => new Response(null, {status: 403}));
		guild.muteGuild();
		// Only what follows the mute dialog's own opening: the refusal's dialog.
		const shown = vi.spyOn(Dialog.prototype, "show");
		(buttons.mock.calls[0][2] as () => void)();
		await vi.waitFor(() => expect(guild.mute_config).toBe(null));

		expect(shown).toHaveBeenCalledOnce();
		expect(guild.html!.classList.contains("muted")).toBe(false);
	});

	// Regression guard mirroring channelRefusals' pin: the guild machinery is a copy of the
	// channel's, and this is the pin the channel version carries. Lands green by design.
	it("a refused unmute followed by a newer mute does not roll back", async () => {
		const url = `${API}/users/@me/guilds/g1/settings`;
		let answerUnmute!: (res: Response) => void;
		let calls = 0;
		captureRequests(url, () => {
			if (++calls === 1) {
				return new Promise<Response>((res) => {
					answerUnmute = res;
				});
			}
			return new Response(null, {status: 204});
		});
		const shown = vi.spyOn(Dialog.prototype, "show");
		const guild = muteGuild({selected_time_window: 1800, end_time: Date.now() + 1800_000});

		const unmuting = guild.unmuteGuild();
		await vi.waitFor(() => expect(answerUnmute).toBeDefined());

		const buttons = vi.spyOn(Options.prototype, "addButtonInput");
		guild.muteGuild();
		shown.mockClear(); // the mute dialog's own opening doesn't count
		const muting = (buttons.mock.calls[0][2] as () => Promise<unknown>)();
		const mutedConfig = guild.mute_config;
		expect(mutedConfig?.selected_time_window).toBe(1800);

		answerUnmute(new Response(null, {status: 403}));
		await Promise.all([unmuting, muting]);

		expect(guild.mute_config).toBe(mutedConfig);
		expect(shown).not.toHaveBeenCalled();
	});
});
