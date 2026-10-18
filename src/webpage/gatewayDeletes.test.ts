import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

const event = (t: string, d: unknown) => ({op: 0, t, d}) as never;

/** A session viewing channel "c1" of guild "g1" (or of the DMs, for "@me"). */
function session(guildId = "g1") {
	const channelids = new Map<string, unknown>();
	const guild = {
		id: guildId,
		delChannel: vi.fn((json: {id: string}) => channelids.delete(json.id)),
		loadChannel: vi.fn(async () => {}),
	};
	const channel = {id: "c1", guild};
	const other = {id: "c2", guild};
	channelids.set("c1", channel);
	channelids.set("c2", other);
	const lu = Object.assign(Object.create(Localuser.prototype), {
		initialized: true,
		guildids: new Map([[guildId, guild]]),
		channelids,
		lookingguild: guild,
		channelfocus: channel,
		// Every event ends by redrawing the unread badges; none of that is under test.
		generateFavicon: () => {},
		refreshInboxBadge: () => {},
		refreshInboxMenu: () => {},
	}) as InstanceType<typeof Localuser>;
	const loadGuild = vi.spyOn(lu, "loadGuild").mockImplementation(() => undefined);
	return {lu, guild, loadGuild};
}

it("deleting the open channel leaves it for the guild's default channel", async () => {
	const {lu, guild} = session();

	await lu.handleEvent(event("CHANNEL_DELETE", {id: "c1", guild_id: "g1"}));

	expect(guild.delChannel).toHaveBeenCalledOnce();
	expect(guild.loadChannel).toHaveBeenCalledWith();
});

// A pin, not red-first: the old code did this too.
it("deleting another channel of the open guild redraws the list and stays put", async () => {
	const {lu, guild, loadGuild} = session();

	await lu.handleEvent(event("CHANNEL_DELETE", {id: "c2", guild_id: "g1"}));

	expect(loadGuild).toHaveBeenCalledWith("g1", true);
	expect(guild.loadChannel).not.toHaveBeenCalled();
});

it("an open group DM that's deleted (or left) leaves the view", async () => {
	const {lu, guild, loadGuild} = session("@me");

	// A DM channel's CHANNEL_DELETE carries no guild_id.
	await lu.handleEvent(event("CHANNEL_DELETE", {id: "c1"}));

	expect(loadGuild).toHaveBeenCalledWith("@me", true);
	expect(guild.loadChannel).toHaveBeenCalledWith();
});

it("a deleted or left thread is removed, like a deleted channel", async () => {
	const {lu, guild} = session();

	await lu.handleEvent(
		event("THREAD_DELETE", {id: "c1", guild_id: "g1", parent_id: "p1", type: 11}),
	);

	expect(guild.delChannel).toHaveBeenCalledWith(expect.objectContaining({id: "c1"}));
	expect(guild.loadChannel).toHaveBeenCalledWith();
});

it("a bulk delete removes every listed message", async () => {
	const {lu} = session();
	const deleted: string[] = [];
	const messages = new Map(
		["m1", "m2", "m3"].map((id) => [id, {deleteEvent: () => deleted.push(id)}]),
	);
	const channel = {id: "c3", messages};
	lu.channelids.set("c3", channel as never);
	const invalidate = vi.spyOn(lu, "invalidateInboxPreview").mockImplementation(() => {});

	await lu.handleEvent(
		event("MESSAGE_DELETE_BULK", {ids: ["m1", "m3", "gone"], channel_id: "c3", guild_id: "g1"}),
	);

	expect(deleted).toEqual(["m1", "m3"]);
	expect(invalidate).toHaveBeenCalledWith(channel);
});
