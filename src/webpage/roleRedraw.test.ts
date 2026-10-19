import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Role} = await import("./role");
const {Member} = await import("./member");

type GuildT = InstanceType<typeof Guild>;
type RoleT = InstanceType<typeof Role>;
type RoleJson = Parameters<GuildT["updateRole"]>[0];
type MemberT = import("./member").Member;

const RED = 0xff0000;
const BLUE = 0x0000ff;
const MODS = "1100000000000000002";
const HELPERS = "1100000000000000001";

afterEach(() => {
	document.querySelectorAll(".roleRedrawName").forEach((name) => name.remove());
});

/** A guild with @everyone, mods (above) and helpers (below), and one member holding both. */
function guildWithMember({modsColor = RED, helpersColor = BLUE} = {}) {
	const memberListQue = vi.fn();
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "1100000000000000000",
		roles: [] as RoleT[],
		roleids: new Map<string, RoleT>(),
		members: new Set(),
		roleUpdate: () => {},
		owner: {
			// Despite the name, true means role colours are shown.
			perminfo: {user: {disableColors: true}},
			user: {id: "1100000000000000099"},
			memberListQue,
		},
	}) as GuildT;
	guild.localuser.lookingguild = guild;
	vi.spyOn(guild, "recalcPrivate").mockImplementation(() => {});
	const role = (id: string, position: number, color: number) => {
		const made = Object.assign(Object.create(Role.prototype), {
			id,
			name: id,
			position,
			color,
			hoist: false,
			owner: guild,
			permissions: {allow: 0n},
		}) as RoleT;
		guild.roles.push(made);
		guild.roleids.set(id, made);
		made.roleLoad();
		return made;
	};
	role(MODS, 2, modsColor);
	role(HELPERS, 1, helpersColor);
	role(guild.id, 0, 0);
	const member = memberOf(guild, "1100000000000000010", [MODS, HELPERS]);
	return {guild, member, name: nameOf(member), memberListQue};
}

function memberOf(guild: GuildT, id: string, roles: string[]) {
	const member = Object.assign(Object.create(Member.prototype), {
		id,
		owner: guild,
		roleIds: new Set(roles),
		user: {id},
	}) as MemberT;
	guild.members.add(member);
	return member;
}

/** The member's name as a message or the member list draws it. */
function nameOf(member: MemberT) {
	const span = document.createElement("span");
	span.classList.add("roleRedrawName");
	document.body.append(span);
	member.bind(span);
	return span;
}

const colourOf = (name: HTMLElement) => name.style.getPropertyValue("--userbg");

const update = (guild: GuildT, json: Partial<RoleJson> & {id: string}) => {
	const role = guild.roleids.get(json.id)!;
	guild.updateRole({
		name: role.name,
		position: role.position,
		color: role.color,
		hoist: role.hoist,
		permissions: "0",
		...json,
	} as RoleJson);
};

it("a role losing its colour hands the name to the next coloured role", () => {
	const {guild, name} = guildWithMember();
	expect(colourOf(name)).toBe(`var(--role-${MODS})`);

	update(guild, {id: MODS, color: 0});

	expect(colourOf(name)).toBe(`var(--role-${HELPERS})`);
});

it("a role gaining a colour takes the name over from a lower role", () => {
	const {guild, name} = guildWithMember({modsColor: 0});
	expect(colourOf(name)).toBe(`var(--role-${HELPERS})`);

	update(guild, {id: MODS, color: RED});

	expect(colourOf(name)).toBe(`var(--role-${MODS})`);
});

it("a role moved above another takes the name's colour", () => {
	const {guild, name} = guildWithMember();

	update(guild, {id: HELPERS, position: 3});

	expect(colourOf(name)).toBe(`var(--role-${HELPERS})`);
});

it("a name whose last coloured role loses its colour goes back to the default", () => {
	const {guild, name} = guildWithMember({helpersColor: 0});

	update(guild, {id: MODS, color: 0});

	expect(colourOf(name)).toBe("");
});

it("a deleted role no longer colours the name", () => {
	const {guild, name} = guildWithMember();

	guild.deleteRole(MODS);

	expect(colourOf(name)).toBe(`var(--role-${HELPERS})`);
});

it("a new role above the others colours the names of members who already hold it", () => {
	const {guild, member, name} = guildWithMember();
	const ADMINS = "1100000000000000003";
	member.roleIds.add(ADMINS);

	guild.newRole({
		id: ADMINS,
		name: "admins",
		position: 3,
		color: 0x00ff00,
		hoist: false,
		permissions: "0",
	} as RoleJson);

	expect(colourOf(name)).toBe(`var(--role-${ADMINS})`);
});

it("another member given a coloured role is redrawn in its colour", () => {
	const {guild} = guildWithMember();
	const other = memberOf(guild, "1100000000000000011", []);
	const name = nameOf(other);
	expect(colourOf(name)).toBe("");

	guild.memberupdate({id: other.id, roles: [MODS]} as Parameters<GuildT["memberupdate"]>[0]);

	expect(colourOf(name)).toBe(`var(--role-${MODS})`);
});

it("only the changed member's names are redrawn", () => {
	const {guild, name} = guildWithMember();
	const other = memberOf(guild, "1100000000000000011", []);
	// A name drawn while mods was red; the other member's change must not touch it.
	name.style.setProperty("--userbg", "var(--role-stale)");

	guild.memberupdate({id: other.id, roles: [HELPERS]} as Parameters<GuildT["memberupdate"]>[0]);

	expect(colourOf(name)).toBe("var(--role-stale)");
});

it("the member list regroups when a role starts or stops being shown separately", () => {
	const {guild, memberListQue} = guildWithMember();

	update(guild, {id: HELPERS, hoist: true});

	expect(memberListQue).toHaveBeenCalled();
});

it("the member list regroups when a member's roles change", () => {
	const {guild, member, memberListQue} = guildWithMember();

	guild.memberupdate({id: member.id, roles: [HELPERS]} as Parameters<GuildT["memberupdate"]>[0]);

	expect(memberListQue).toHaveBeenCalled();
});

it("a guild that isn't open leaves the member list alone", () => {
	const {guild, memberListQue} = guildWithMember();
	guild.localuser.lookingguild = undefined;

	update(guild, {id: HELPERS, hoist: true});
	guild.deleteRole(MODS);

	expect(memberListQue).not.toHaveBeenCalled();
});
