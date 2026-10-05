import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Role, RoleList} = await import("./role");

afterEach(() => {
	vi.restoreAllMocks();
});

const GUILD = "100";

/**
 * A guild where the viewer holds @everyone and a top role "50" at position 3, has MANAGE_ROLES
 * unless told otherwise, and isn't the owner unless told so.
 */
function guildOf({owner = false, manageRoles = true} = {}) {
	const guild = {
		id: GUILD,
		member: {
			id: "me",
			hasPermission: (name: string) => manageRoles && name === "MANAGE_ROLES",
			roles: [] as InstanceType<typeof Role>[],
		},
		properties: {owner_id: owner ? "me" : "someone"},
		roleids: new Map<string, InstanceType<typeof Role>>(),
		localuser: {userMap: new Map()},
	};
	guild.member.roles.push(role(guild, GUILD, 0), role(guild, "50", 3));
	return guild;
}

function role(guild: object, id: string, position: number) {
	return Object.assign(Object.create(Role.prototype), {
		id,
		position,
		color: 0,
		owner: guild,
	}) as InstanceType<typeof Role>;
}

it("a member can't manage their own top role", () => {
	const guild = guildOf();
	expect(guild.member.roles[1].canManage()).toBe(false);
});

it("a member manages roles below their top role (the control)", () => {
	expect(role(guildOf(), "60", 2).canManage()).toBe(true);
});

it("a role tied with the top role ranks by id, as the server ranks it: the older id is above", () => {
	const guild = guildOf();
	expect(role(guild, "40", 3).canManage()).toBe(false);
	expect(role(guild, "70", 3).canManage()).toBe(true);
});

it("@everyone sits below every role", () => {
	const guild = guildOf();
	guild.member.roles = [role(guild, GUILD, 0)];
	expect(role(guild, "60", 0).canManage()).toBe(false);
	expect(role(guild, GUILD, 0).canManage()).toBe(false);
});

it("without MANAGE_ROLES nothing is manageable", () => {
	expect(role(guildOf({manageRoles: false}), "60", 1).canManage()).toBe(false);
});

it("the owner manages every role", () => {
	expect(role(guildOf({owner: true}), "60", 5).canManage()).toBe(true);
});

/** Builds a channel's overwrite list holding one role above the viewer's own top role. */
function channelList(channelGrantsManageRoles: boolean) {
	const guild = guildOf();
	const above = role(guild, "90", 7);
	guild.roleids.set("90", above);
	const bound = vi.spyOn(RoleList.channelrolemenu, "bindContextmenu");
	const list = Object.assign(Object.create(RoleList.prototype), {
		guild,
		channel: {
			id: "c1",
			hasPermission: (name: string) => channelGrantsManageRoles && name === "MANAGE_ROLES",
		},
		buttons: [["Above", "90"]],
		permissions: [],
		buttonMap: new Map(),
	}) as InstanceType<typeof RoleList>;
	list.buttonListGen(document.createElement("div"));
	return {bound, list, above};
}

it("a channel's overwrite for a role above one's own can still be removed (no hierarchy rule there)", () => {
	const {bound, list, above} = channelList(true);
	expect(bound).toHaveBeenCalledWith(expect.any(HTMLButtonElement), list, above);
});

it("a channel's overwrites can't be removed where that channel withholds MANAGE_ROLES", () => {
	const {bound} = channelList(false);
	expect(bound).not.toHaveBeenCalled();
});
