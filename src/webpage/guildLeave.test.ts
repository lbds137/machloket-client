import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");

const event = (t: string, d: unknown) => ({op: 0, t, d}) as never;

const guildNamed = (id: string) =>
	Object.assign(Object.create(Guild.prototype), {id, html: document.createElement("div")});

/** A session in guild g1 (in a folder with g3; g2 on its own), with a channel and a thread of
 * g1's and a channel of g2's known. */
function session() {
	const [g1, g2, g3] = ["g1", "g2", "g3"].map(guildNamed);
	const folder = {id: 1, name: "f", guilds: [g1, g3]};
	const lu = Object.assign(Object.create(Localuser.prototype), {
		initialized: true,
		guilds: [g1, g2, g3],
		guildids: new Map([
			["g1", g1],
			["g2", g2],
			["g3", g3],
		]),
		channelids: new Map([
			["c1", {id: "c1", guild: g1}],
			["t1", {id: "t1", guild: g1}],
			["c2", {id: "c2", guild: g2}],
		]),
		guildOrder: [folder, g2],
		dragMap: new WeakMap(),
		lookingguild: g2,
		generateFavicon: () => {},
		refreshInboxBadge: () => {},
		refreshInboxMenu: () => {},
		giveUpMemberLookups: () => {},
	}) as InstanceType<typeof Localuser>;
	return {lu, folder, g2, g3};
}

it("leaving a guild forgets its channels and threads, so nothing offers them as targets", async () => {
	const {lu} = session();

	await lu.handleEvent(event("GUILD_DELETE", {id: "g1"}));

	expect([...lu.channelids.keys()]).toEqual(["c2"]);
});

it("leaving a guild takes it out of its folder in the saved server order", async () => {
	const {lu, folder, g2, g3} = session();

	await lu.handleEvent(event("GUILD_DELETE", {id: "g1"}));

	expect(folder.guilds).toEqual([g3]);
	expect(lu.guildOrder).toEqual([folder, g2]);
});

it("a folder that leaving a guild empties goes from the order and the server list", async () => {
	const {lu, folder, g2} = session();
	const servers = document.createElement("div");
	servers.id = "servers";
	const folderHtml = document.createElement("div");
	servers.append(folderHtml);
	document.body.append(servers);
	lu.dragMap.set(folderHtml, folder as never);

	await lu.handleEvent(event("GUILD_DELETE", {id: "g1"}));
	await lu.handleEvent(event("GUILD_DELETE", {id: "g3"}));

	expect(lu.guildOrder).toEqual([g2]);
	expect(folderHtml.isConnected).toBe(false);
	servers.remove();
});

// A pin, not red-first: the old code dropped the guild itself too.
it("leaving a guild drops it from the guild list", async () => {
	const {lu} = session();
	vi.spyOn(lu, "loadGuild").mockImplementation(() => undefined);

	await lu.handleEvent(event("GUILD_DELETE", {id: "g1"}));

	expect(lu.guildids.has("g1")).toBe(false);
	expect(lu.guilds.map((g) => g.id)).toEqual(["g2", "g3"]);
});
