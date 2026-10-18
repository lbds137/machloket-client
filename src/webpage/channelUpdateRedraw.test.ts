import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

it("a channel update in the guild on screen redraws its sidebar", () => {
	const guild = {id: "g1", updateChannel: vi.fn()};
	const user = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["g1", guild]]),
		lookingguild: guild,
	});
	const loadGuild = vi.spyOn(user, "loadGuild").mockImplementation(() => undefined);

	// A moderator moved a channel: the open guild's list must show the new order now.
	user.updateChannel({id: "c1", guild_id: "g1", position: 5} as never);

	expect(guild.updateChannel).toHaveBeenCalled();
	expect(loadGuild).toHaveBeenCalledWith("g1", true);
});
