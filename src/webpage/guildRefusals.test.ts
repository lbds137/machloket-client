import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Channel} = await import("./channel");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://refusals.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());
});

function makeGuild(extra: Record<string, unknown> = {}) {
	return Object.assign(
		Object.create(Guild.prototype),
		{
			id: "g1",
			headers: {},
			owner: {info: {api: API}, lookingguild: null},
		},
		extra,
	);
}

it("a refused leave in confirmleave shows the refusal dialog; a 204 opens none", async () => {
	await I18n.done;
	const guild = makeGuild();

	captureRequests(API + "/users/@me/guilds/g1", () => new Response(null, {status: 403}));
	const addButton = vi.spyOn(Options.prototype, "addButtonInput");
	guild.confirmleave();
	const shown = vi.spyOn(Dialog.prototype, "show");
	await (addButton.mock.calls[0][2] as () => Promise<void>)();
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	addButton.mockClear();
	captureRequests(API + "/users/@me/guilds/g1", () => new Response(null, {status: 204}));
	guild.confirmleave();
	shown.mockClear();
	await (addButton.mock.calls[0][2] as () => Promise<void>)();
	expect(shown).not.toHaveBeenCalled();
});

it("recalcRoles restores the previous role order and shows a dialog when refused, and keeps the new order when accepted", async () => {
	const r1 = {id: "r1", position: 1};
	const r2 = {id: "r2", position: 2};
	const previous = [r1, r2];
	const guild = makeGuild({roles: [r2, r1]});
	const shown = vi.spyOn(Dialog.prototype, "show");

	captureRequests(API + "/guilds/g1/roles", () => new Response(null, {status: 403}));
	expect(await guild.recalcRoles(previous)).toBe(false);
	expect(guild.roles).toEqual([r1, r2]);
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	guild.roles = [r2, r1];
	captureRequests(API + "/guilds/g1/roles", () => new Response(null, {status: 204}));
	expect(await guild.recalcRoles(previous)).toBe(true);
	expect(guild.roles).toEqual([r2, r1]);
	expect(shown).not.toHaveBeenCalled();
});

it("calculateReorder calls restore and shows a dialog when refused with restore, and stays silent without restore", async () => {
	const guild = makeGuild();
	const c1 = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		name: "general",
		position: 1,
		children: [],
		type: 0,
		owner: guild,
	});
	const c2 = Object.assign(Object.create(Channel.prototype), {
		id: "c2",
		name: "random",
		position: 0,
		children: [],
		type: 0,
		owner: guild,
	});
	guild.channels = [c1, c2];
	guild.headchannels = [c1, c2];

	captureRequests(API + "/guilds/g1/channels", () => new Response(null, {status: 403}));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const restore = vi.fn();

	await guild.calculateReorder("c1", restore);
	expect(restore).toHaveBeenCalledOnce();
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	await guild.calculateReorder("c1");
	expect(shown).not.toHaveBeenCalled();
});

it("snapshotLayout restores headchannels order, position, parent, move_id, and children", () => {
	const guild = makeGuild();
	const cat = Object.assign(Object.create(Channel.prototype), {
		id: "cat",
		position: 0,
		parent: undefined,
		parent_id: undefined,
		move_id: undefined,
		children: [],
		type: 4,
		owner: guild,
	});
	const c1 = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		position: 1,
		parent: undefined,
		parent_id: undefined,
		move_id: undefined,
		children: [],
		type: 0,
		owner: guild,
	});
	const c2 = Object.assign(Object.create(Channel.prototype), {
		id: "c2",
		position: 2,
		parent: undefined,
		parent_id: undefined,
		move_id: undefined,
		children: [],
		type: 0,
		owner: guild,
	});
	guild.channels = [cat, c1, c2];
	guild.headchannels = [cat, c1, c2];

	const restore = guild.snapshotLayout();

	guild.headchannels = [c2, cat];
	c1.position = 99;
	c1.parent = cat;
	c1.parent_id = "cat";
	c1.move_id = "cat";
	cat.children.push(c1);

	restore();

	expect(guild.headchannels).toEqual([cat, c1, c2]);
	expect(c1.position).toBe(1);
	expect(c1.parent).toBeUndefined();
	expect(c1.parent_id).toBeUndefined();
	expect(c1.move_id).toBeUndefined();
	expect(cat.children).toEqual([]);
});

it("saveWelcomeScreen returns false and opens a dialog when refused, and returns true with no dialog on 204", async () => {
	const guild = makeGuild();
	const shown = vi.spyOn(Dialog.prototype, "show");

	captureRequests(API + "/guilds/g1/welcome-screen", () => new Response(null, {status: 403}));
	expect(await guild.saveWelcomeScreen({enabled: false})).toBe(false);
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	captureRequests(API + "/guilds/g1/welcome-screen", () => new Response(null, {status: 204}));
	expect(await guild.saveWelcomeScreen({enabled: false})).toBe(true);
	expect(shown).not.toHaveBeenCalled();
});

it("a refused welcome screen save puts its description back, so a later save won't carry it", async () => {
	const guild = makeGuild();
	captureRequests(API + "/guilds/g1/welcome-screen", () => new Response(null, {status: 403}));
	const screen = {enabled: true, description: "edited", welcome_channels: []};

	expect(await guild.saveWelcomeEdits(screen, "saved")).toBe("saved");
	expect(screen.description).toBe("saved");

	captureRequests(API + "/guilds/g1/welcome-screen", () => new Response(null, {status: 204}));
	screen.description = "edited again";
	expect(await guild.saveWelcomeEdits(screen, "saved")).toBe("edited again");
	expect(screen.description).toBe("edited again");
});

/** A guild with top-level text channels `ids`, positioned in that order. */
function guildWithChannels(...ids: string[]) {
	const guild = makeGuild();
	const channels = ids.map((id, position) =>
		Object.assign(Object.create(Channel.prototype), {
			id,
			position,
			children: [],
			type: 0,
			owner: guild,
		}),
	);
	guild.channels = [...channels];
	guild.headchannels = [...channels];
	return {guild, channels};
}

it("an older drag's restore leaves the layout alone once a newer drag has started", () => {
	const {guild, channels: [c1]} = guildWithChannels("c1", "c2");
	const restoreFirst = guild.snapshotLayout();
	c1.position = 5;
	guild.snapshotLayout();

	restoreFirst();

	expect(c1.position).toBe(5);
});

it("a restore keeps a channel created since the snapshot and drops one deleted since", () => {
	const {guild, channels: [c1, c2]} = guildWithChannels("c1", "c2");
	const restore = guild.snapshotLayout();
	const c3 = Object.assign(Object.create(Channel.prototype), {
		id: "c3",
		position: 2,
		children: [],
		type: 0,
		owner: guild,
	});
	guild.channels = [c1, c3];
	guild.headchannels = [c3, c1];

	restore();

	expect(guild.headchannels).toEqual([c1, c3]);
	expect(guild.headchannels).not.toContain(c2);
});

it("a restore redraws the channel list when its guild is on screen", () => {
	const {guild, channels: [c1]} = guildWithChannels("c1");
	Object.assign(guild.owner, {lookingguild: guild});
	const channelsDiv = document.createElement("div");
	channelsDiv.id = "channels";
	channelsDiv.textContent = "stale";
	document.body.append(channelsDiv);
	c1.createguildHTML = () => {
		const d = document.createElement("div");
		d.textContent = c1.id;
		return d;
	};

	try {
		guild.snapshotLayout()();

		expect(channelsDiv.textContent).toBe("c1");
	} finally {
		channelsDiv.remove();
	}
});

/** A guild whose admin listing has two roles to ask member ids of (everyone grants nothing). */
function adminGuild() {
	const role = (id: string, grants: boolean) => ({
		id,
		permissions: {hasPermission: () => grants},
	});
	const resolvemember = vi.fn(async () => undefined);
	const guild = makeGuild({
		roleids: new Map([["g1", role("g1", false)]]),
		roles: [role("r1", true), role("r2", true)],
		properties: {owner_id: "owner"},
		owner: {info: {api: API}, lookingguild: null, resolvemember},
	});
	return {guild, resolvemember};
}

/** The admins dialog's text: what the user reads while, or after, the listing loads. */
const adminsText = () => document.body.textContent;

it("a refused member-counts GET in the admins menu says why instead of listing anyone", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () =>
		Response.json({message: "boom"}, {status: 500}),
	);
	const {guild} = adminGuild();

	await guild.findAdmin().catch(() => {});

	expect(adminsText()).toContain(I18n.requestFailed("boom"));
	expect(adminsText()).not.toContain(I18n.loading());
});

it("a member-counts GET that never arrived says the network failed in the admins menu", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () =>
		Promise.reject(new TypeError("offline")),
	);
	const {guild} = adminGuild();

	await guild.findAdmin().catch(() => {});

	expect(adminsText()).toContain(I18n.requestFailed("offline"));
	expect(adminsText()).not.toContain(I18n.loading());
});

it("a member-counts answer that isn't JSON says why in the admins menu", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () => new Response("<html>"));
	const {guild} = adminGuild();

	await guild.findAdmin().catch(() => {});

	// The body is consumed by the guarded json(), so refusalText can only say "HTTP 200".
	expect(adminsText()).toContain(I18n.requestFailed("HTTP 200"));
	expect(adminsText()).not.toContain(I18n.loading());
});

it("one refused role member-ids GET says why instead of listing a partial set of admins", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () => Response.json({}));
	captureRequests(API + "/guilds/g1/roles/r1/member-ids", () => Response.json(["u1"]));
	captureRequests(API + "/guilds/g1/roles/r2/member-ids", () =>
		Response.json({message: "boom"}, {status: 500}),
	);
	const {guild, resolvemember} = adminGuild();

	await guild.findAdmin();

	await vi.waitFor(() => expect(adminsText()).toContain(I18n.requestFailed("boom")));
	expect(adminsText()).not.toContain(I18n.guild.adminMenu.finding());
	expect(resolvemember).not.toHaveBeenCalled();
});

it("a role member-ids GET that never arrived says the network failed in the admins menu", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () => Response.json({}));
	captureRequests(API + "/guilds/g1/roles/r1/member-ids", () => Response.json(["u1"]));
	captureRequests(API + "/guilds/g1/roles/r2/member-ids", () =>
		Promise.reject(new TypeError("offline")),
	);
	const {guild, resolvemember} = adminGuild();

	await guild.findAdmin();

	await vi.waitFor(() => expect(adminsText()).toContain(I18n.requestFailed("offline")));
	expect(resolvemember).not.toHaveBeenCalled();
});

it("a role member-ids answer that isn't an id list says why in the admins menu", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () => Response.json({}));
	captureRequests(API + "/guilds/g1/roles/r1/member-ids", () => Response.json(["u1"]));
	captureRequests(API + "/guilds/g1/roles/r2/member-ids", () => new Response("<html>"));
	const {guild, resolvemember} = adminGuild();

	await guild.findAdmin();

	// The body is consumed by the guarded json(), so refusalText can only say "HTTP 200".
	await vi.waitFor(() => expect(adminsText()).toContain(I18n.requestFailed("HTTP 200")));
	expect(resolvemember).not.toHaveBeenCalled();
});

it("accepted member-ids answers resolve each listed admin (the control)", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/roles/member-counts/", () => Response.json({}));
	captureRequests(API + "/guilds/g1/roles/r1/member-ids", () => Response.json(["u1"]));
	captureRequests(API + "/guilds/g1/roles/r2/member-ids", () => Response.json(["u2"]));
	const {guild, resolvemember} = adminGuild();

	await guild.findAdmin();

	await vi.waitFor(() => expect(resolvemember).toHaveBeenCalledTimes(3));
	expect(resolvemember.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual([
		"owner",
		"u1",
		"u2",
	]);
});
