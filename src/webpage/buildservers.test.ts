import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Direct} = await import("./direct");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://buildservers.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** A session holding the DMs and one guild, and the empty pillar it builds into. */
function session() {
	const servers = document.createElement("div");
	servers.id = "servers";
	document.body.append(servers);

	const direct = Object.assign(Object.create(Direct.prototype), {id: "@me"});
	vi.spyOn(direct, "unreaddms").mockImplementation(() => {});
	const guild = Object.assign(Object.create(Guild.prototype), {id: "g1"});
	const user = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: API},
		headers: {},
		guilds: [direct, guild],
		guildids: new Map<string, unknown>([
			["@me", direct],
			["g1", guild],
		]),
		guildFolders: [],
		acceptedFolders: [],
		guildOrder: [guild],
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(user, "unreads").mockImplementation(() => {});
	vi.spyOn(user, "makeGuildIcon").mockImplementation((forGuild) => {
		const icon = document.createElement("div");
		icon.classList.add("testGuildIcon");
		forGuild.html = icon;
		return icon as never;
	});
	return {user, servers, direct, guild};
}

function pillarCounts(servers: HTMLElement) {
	return {
		home: servers.querySelectorAll(".svg-home").length,
		dms: servers.querySelectorAll("#sentdms").length,
		guilds: servers.querySelectorAll(".testGuildIcon").length,
		separators: servers.querySelectorAll("#bottomseparator").length,
	};
}

const ONE_PILLAR = {home: 1, dms: 1, guilds: 1, separators: 1};

// A session-less reconnect identifies and runs init() again without unload() having emptied
// the pillar: op 9 drops the session, and the close that follows takes the quick retry.
it("building the pillar a second time replaces the first one", () => {
	const {user, servers} = session();

	user.buildservers();
	expect(pillarCounts(servers)).toEqual(ONE_PILLAR);

	user.buildservers();
	expect(pillarCounts(servers), "the rebuild leaves one of everything").toEqual(ONE_PILLAR);
});

// A guild opened before the rebuild stays open after it, and loadGuild won't mark it again:
// it returns early for the guild already being looked at.
it.each(["a guild", "the DMs"])("the rebuild keeps %s marked as open", (open) => {
	const {user, direct, guild} = session();
	const looking = open === "the DMs" ? direct : guild;
	user.buildservers();
	const before = looking.html;
	user.lookingguild = looking;

	user.buildservers();

	expect(looking.html, "the rebuild draws a new element").not.toBe(before);
	expect(looking.html.classList.contains("serveropen")).toBe(true);
});

it("a refused reorder rebuilds into one pillar, with the open guild still marked", async () => {
	await I18n.done;
	const {user, servers, guild} = session();
	vi.spyOn(Dialog.prototype, "show").mockImplementation(() => document.createElement("div"));
	captureRequests(API + "/users/@me/settings", () => new Response(null, {status: 403}));
	user.buildservers();
	user.lookingguild = guild;

	await user.saveGuildOrder();

	expect(pillarCounts(servers)).toEqual(ONE_PILLAR);
	expect(guild.html.classList.contains("serveropen")).toBe(true);
});
