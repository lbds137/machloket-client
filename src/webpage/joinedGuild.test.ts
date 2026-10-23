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

it("GUILD_CREATE adds the joined guild to guildOrder, so the next save keeps it", async () => {
	document.body.innerHTML = '<div id="servers"><div id="bottomseparator"></div></div>';
	const existing = {id: "g0"};
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
	expect(user.guildOrder[0]).toBe(existing);
});
