import {expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");

const API = "http://thread.test/api/v9";

/** A guild whose session hasn't loaded thread "t1" (an archived one, say). */
function guildWithoutThread() {
	const goToChannel = vi.fn(async () => {});
	const loadChannel = vi.fn();
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		// `localuser`, `info` and `headers`-reading getters go through the owner.
		owner: {
			channelids: new Map(),
			goToChannel,
			info: {api: API},
			perminfo: {guilds: {g1: {channels: {}}}},
			unknownRead: new Map(),
		},
		headers: {Authorization: "t"},
		loadChannel,
	});
	return {guild, goToChannel, loadChannel};
}

it("a thread the server returns is opened, not swapped for the default channel", async () => {
	captureRequests(API + "/channels/t1", () =>
		Response.json({id: "t1", type: 11, guild_id: "g1", parent_id: "c1", name: "a thread"}),
	);
	const {guild, goToChannel, loadChannel} = guildWithoutThread();

	await guild.goToThread("t1");

	expect(loadChannel).not.toHaveBeenCalled();
	expect(goToChannel).toHaveBeenCalledWith("t1");
});

it("a thread the server refuses falls back to the default channel without waiting on it", async () => {
	captureRequests(API + "/channels/t1", () =>
		Response.json({code: 10003, message: "Unknown Channel"}, {status: 404}),
	);
	const {guild, goToChannel, loadChannel} = guildWithoutThread();

	await guild.goToThread("t1");

	expect(loadChannel).toHaveBeenCalled();
	expect(goToChannel).not.toHaveBeenCalled();
});
