import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Role} = await import("./role");

function role(id: string, position: number) {
	return Object.assign(Object.create(Role.prototype), {id, name: id, position}) as InstanceType<
		typeof Role
	>;
}

it("a role another admin moved takes its new place in the guild's order", () => {
	const mods = role("mods", 2);
	const helpers = role("helpers", 1);
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		roles: [mods, helpers],
		members: new Set(),
		owner: {},
		roleUpdate: () => {},
		roleids: new Map([
			["mods", mods],
			["helpers", helpers],
		]),
	}) as InstanceType<typeof Guild>;
	vi.spyOn(guild, "recalcPrivate").mockImplementation(() => {});
	vi.spyOn(helpers, "newJson").mockImplementation(function (this: {position: number}, json) {
		this.position = json.position;
	});

	guild.updateRole({id: "helpers", position: 3} as Parameters<typeof guild.updateRole>[0]);

	expect(guild.roles.map(({id}) => id)).toEqual(["helpers", "mods"]);
});
