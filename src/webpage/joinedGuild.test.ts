import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

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
