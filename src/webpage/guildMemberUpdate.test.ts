import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");

/** A guild with the user's own member "me" and another member "u2"; `viewing` says whether
 * this guild is the one open. */
function guildWithMembers(viewing: boolean) {
	const me = {id: "me", update: vi.fn()};
	const other = {id: "u2", update: vi.fn()};
	const loadGuild = vi.fn();
	const owner = {loadGuild, lookingguild: undefined as unknown};
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		members: new Set([me, other]),
		member: me,
		// `localuser` is a getter on the prototype: it reads the owner.
		owner,
	});
	owner.lookingguild = viewing ? guild : {id: "g2"};
	return {guild, me, other, loadGuild};
}

it("a member update keyed by its user (Discord's shape, no top-level id) reaches the member", () => {
	const {guild, other} = guildWithMembers(true);

	guild.memberupdate({user: {id: "u2"}, roles: ["r1"]} as never);

	expect(other.update).toHaveBeenCalled();
});

it("an update to your own member in another guild doesn't switch the view to it", () => {
	const {guild, me, loadGuild} = guildWithMembers(false);

	guild.memberupdate({user: {id: "me"}, roles: ["r1"]} as never);

	expect(me.update).toHaveBeenCalled();
	expect(loadGuild).not.toHaveBeenCalled();
});

it("an update to your own member in the open guild redraws it", () => {
	const {guild, loadGuild} = guildWithMembers(true);

	guild.memberupdate({user: {id: "me"}, roles: ["r1"]} as never);

	expect(loadGuild).toHaveBeenCalledWith("g1", true);
});

it("a member update with a top-level id (the member routes' shape) still reaches the member", () => {
	const {guild, other} = guildWithMembers(true);

	guild.memberupdate({id: "u2", user: {id: "u2"}, roles: ["r1"]} as never);

	expect(other.update).toHaveBeenCalled();
});
