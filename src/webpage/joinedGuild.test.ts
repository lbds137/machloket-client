import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Member} = await import("./member");
const {User} = await import("./user");

afterEach(() => {
	vi.restoreAllMocks();
});

function session(known: string[]) {
	const user = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map(known.map((id) => [id, {id}])),
	});
	const loadGuild = vi.spyOn(user, "loadGuild").mockImplementation(() => undefined);
	return {user, loadGuild};
}

it("a guild joined before its GUILD_CREATE opens when it arrives, not the DMs now", () => {
	const {user, loadGuild} = session([]);

	user.openJoinedGuild("g1");
	expect(loadGuild).not.toHaveBeenCalled();

	user.guildArrived("g2"); // someone else's guild: not the one waited for
	expect(loadGuild).not.toHaveBeenCalled();
	user.guildArrived("g1");
	expect(loadGuild).toHaveBeenCalledWith("g1");
});

it("a guild already known opens at once", () => {
	const {user, loadGuild} = session(["g1"]);

	user.openJoinedGuild("g1");

	expect(loadGuild).toHaveBeenCalledWith("g1");
	// Nothing left waiting: a later GUILD_CREATE for it doesn't move the view again.
	loadGuild.mockClear();
	user.guildArrived("g1");
	expect(loadGuild).not.toHaveBeenCalled();
});

it("going elsewhere drops the wait, so a late arrival doesn't pull the view back", () => {
	const {user, loadGuild} = session(["g2"]);
	loadGuild.mockRestore();
	const load = vi.spyOn(user, "loadGuild");
	// loadGuild's own body needs a page; only its entry matters here.
	load
		.mockImplementationOnce(Object.getPrototypeOf(user).loadGuild.bind(user))
		.mockImplementation(() => undefined);

	user.openJoinedGuild("g1");
	try {
		user.loadGuild("g2");
	} catch {
		// the page-less body throws past the part under test
	}
	user.guildArrived("g1");

	expect(load).not.toHaveBeenCalledWith("g1");
});

it("the join landing opens the guild's channel only when the guild actually switched", () => {
	const guild = {id: "g1", loadChannel: vi.fn(async () => {})};
	const user = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["g1", guild]]),
		lookingguild: undefined,
	}) as InstanceType<typeof Localuser>;
	const loadGuild = vi.spyOn(user, "loadGuild").mockImplementation(() => guild as never);

	user.loadGuildAndOpenChannel("g1");
	expect(loadGuild).toHaveBeenCalledWith("g1");
	expect(guild.loadChannel, "the switch opens the guild's channel").toHaveBeenCalledTimes(1);

	// Already looking at that guild: the sidebar didn't switch, nothing reopens.
	user.lookingguild = guild as never;
	user.loadGuildAndOpenChannel("g1");
	expect(guild.loadChannel).toHaveBeenCalledTimes(1);
});

it("loadGuildAndOpenChannel catches a rejected loadChannel with console.error", async () => {
	const err = new Error("channel load failed");
	const guild = {id: "g1", loadChannel: vi.fn(() => Promise.reject(err))};
	const user = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["g1", guild]]),
		lookingguild: undefined,
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(user, "loadGuild").mockImplementation(() => guild as never);
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

	user.loadGuildAndOpenChannel("g1");
	await Promise.resolve();

	expect(errorSpy).toHaveBeenCalledWith(err);
});

it("both join arms land through the helper: a known guild and an arrived one", () => {
	const guild = {id: "g1", loadChannel: vi.fn(async () => {})};
	const known = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["g1", guild]]),
		joinedGuildId: undefined,
		lookingguild: undefined,
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(known, "loadGuild").mockImplementation(() => guild as never);
	known.openJoinedGuild("g1");
	expect(guild.loadChannel).toHaveBeenCalledTimes(1);

	const arrivedGuild = {id: "g2", loadChannel: vi.fn(async () => {})};
	const waiting = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["g2", arrivedGuild]]),
		joinedGuildId: "g2",
		lookingguild: undefined,
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(waiting, "loadGuild").mockImplementation(() => arrivedGuild as never);
	waiting.guildArrived("g2");
	expect(arrivedGuild.loadChannel, "the arrival lands too").toHaveBeenCalledTimes(1);
});

/** Delivers a GUILD_CREATE for g9 to a session whose order already holds `existing`. */
async function guildCreate(existing: {id: string}) {
	const user = Object.assign(Object.create(Localuser.prototype), {
		headers: {},
		guilds: [],
		guildids: new Map(),
		guildOrder: [existing],
		channelids: new Map(),
		// Localuser.perminfo is accessor-backed; Guild walks owner.perminfo.guilds.
		userinfo: {localuserStore: {guilds: {}, channels: {}}},
		user: Object.create(User.prototype),
	}) as InstanceType<typeof Localuser>;
	const icon = document.createElement("div");
	vi.spyOn(user, "makeGuildIcon").mockReturnValue(icon);
	// The dispatch's tail updates the favicon; its DM walk needs a page this fixture skips.
	vi.spyOn(user, "generateFavicon").mockImplementation(() => {});
	vi.spyOn(Guild.prototype, "showWelcome").mockImplementation(() => Promise.resolve());
	vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	await user.handleEvent({
		op: 0,
		t: "GUILD_CREATE",
		d: {
			id: "g9",
			name: "Joined",
			large: false,
			member_count: 1,
			emojis: [],
			stickers: [],
			roles: [],
			channels: [],
			threads: [],
			properties: {id: "g9", name: "Joined", default_message_notifications: 0},
		},
	} as never);

	await vi.waitFor(() =>
		expect((user.guildOrder[1] as {id?: string} | undefined)?.id).toBe("g9"),
	);
	return {user, icon};
}

it("GUILD_CREATE adds the joined guild to guildOrder, so the next save keeps it", async () => {
	document.body.innerHTML = '<div id="servers"><div id="bottomseparator"></div></div>';
	const existing = {id: "g0"};

	const {user, icon} = await guildCreate(existing);

	expect(user.guildOrder[0]).toBe(existing);
	expect(icon.nextElementSibling?.id, "a mid-session join mounts its icon").toBe("bottomseparator");
});

// A frame queued behind READY runs before init() builds the pillar: buildservers draws this
// guild from this.guilds, so an icon mounted now would be a stale second one.
it("GUILD_CREATE before the pillar is built keeps the guild and mounts nothing", async () => {
	document.body.innerHTML = '<div id="servers"></div>';

	const {user, icon} = await guildCreate({id: "g0"});

	expect(user.guilds.map((guild) => guild.id)).toEqual(["g9"]);
	expect(icon.isConnected, "buildservers draws this guild's icon later").toBe(false);
	expect(document.getElementById("servers")!.childElementCount).toBe(0);
});
