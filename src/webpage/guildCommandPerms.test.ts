import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Member} = await import("./member");

const API_ROOT = "http://guild.test";
const GUILD_ID = "1554722916606791818";
const INDEX = `${API_ROOT}/guilds/${GUILD_ID}/application-command-index`;
const JSON_HEADERS = {"Content-Type": "application/json"};

const command = (
	id: string,
	name: string,
	perms?: string | null,
	permissions?: {
		user?: boolean;
		roles?: {[id: string]: boolean};
		channels?: {[id: string]: boolean};
	} | null,
	type = 1,
) => ({
	id,
	type,
	application_id: "300",
	name,
	description: "",
	dm_permission: true,
	...(perms === undefined ? {} : {default_member_permissions: perms}),
	...(permissions === undefined ? {} : {permissions}),
});

const indexBody = (
	commands: ReturnType<typeof command>[],
	applications: {id: string; name: string; owner_id?: string}[] = [{id: "300", name: "Echo"}],
) =>
	() =>
		new Response(
			JSON.stringify({applications, application_commands: commands}),
			{headers: JSON_HEADERS},
		);

/** A member whose roles are `roles` (the Member.roles getter, shadowed as the fixtures do). */
function memberWith(roles: {permissions: {allow: bigint}}[], roleIds?: string[], userId = "me") {
	const member = Object.create(Member.prototype);
	Object.defineProperty(member, "roles", {value: roles});
	Object.defineProperty(member, "user", {value: {id: userId}});
	member.roleIds = new Set(roleIds ?? []);
	return member;
}

/** A guild with only what the command fetch reads. `member` is attached only when given:
 * an unresolved guild has no `member` field at all. */
function guildFor(member?: unknown) {
	return Object.assign(Object.create(Guild.prototype), {
		id: GUILD_ID,
		properties: {owner_id: "someone-else"},
		owner: {
			info: {api: API_ROOT},
			headers: {"Content-Type": "application/json", Authorization: "token"},
		},
		...(member === undefined ? {} : {member}),
	}) as InstanceType<typeof Guild>;
}

const names = (list: {name: string}[]) => list.map((c) => c.name);

describe("command visibility follows the member's permissions when they change", () => {
	it("a permission granted after the first fetch shows the command, from the same cached index", async () => {
		const requests = captureRequests(
			INDEX,
			indexBody([command("1", "random"), command("2", "purge", "8192")]),
		);
		// MANAGE_MESSAGES (bit 13) is not held yet.
		const role = {permissions: {allow: 1n << 10n}};
		const guild = guildFor(memberWith([role]));
		expect(names(await guild.getCommands())).toEqual(["random"]);

		// A role edit writes the role's permissions (guild.ts's role editor does the same).
		role.permissions.allow |= 8192n;
		const after = names(await guild.getCommands());

		// Cached: the index is not re-requested, the list is re-read.
		expect(requests).toHaveLength(1);
		expect(after).toEqual(["random", "purge"]);
	});

	it("a member attached after the first fetch filters the list: an admins-only command is hidden", async () => {
		captureRequests(
			INDEX,
			indexBody([command("1", "random"), command("2", "purge", "8192"), command("3", "wipe", "8")]),
		);
		const guild = guildFor();
		// The first fetch runs while the member is unresolved: nothing can be filtered yet.
		await guild.getCommands();

		// The member resolves later (Guild's constructor assigns `this.member` when it does).
		guild.member = memberWith([{permissions: {allow: 1n << 10n}}]) as never;
		const after = names(await guild.getCommands());

		expect(after).not.toContain("wipe");
		expect(after).toEqual(["random"]);
	});
});

describe('default_member_permissions "0" and null, read through getCommands', () => {
	// Pins C-F2's rule on the observable list (getCommands), not on getCommandsFetch: the
	// existing guildCommands.test.ts case binds to getCommandsFetch, which the fix stops filtering.
	it('"0" stays admins-only for a plain member; null and absent stay everyone', async () => {
		captureRequests(
			INDEX,
			indexBody([
				command("1", "random"),
				command("2", "adminonly", "0"),
				command("3", "nullperms", null),
				command("4", "absentperms"),
			]),
		);
		const guild = guildFor(memberWith([{permissions: {allow: (1n << 10n) | (1n << 11n)}}]));

		expect(names(await guild.getCommands())).toEqual(["random", "nullperms", "absentperms"]);
	});
});

describe("per-command permission overrides (2026-10-16 ruling)", () => {
	const modRoleId = "901";
	const deniedChannelId = "801";
	const otherChannelId = "802";

	it("a command with permissions {user:false, roles:{[modRoleId]:true}} is listed for a member holding modRoleId and absent for one who does not", async () => {
		captureRequests(
			INDEX,
			indexBody([
				command("1", "modonly", null, {user: false, roles: {[modRoleId]: true}}),
			]),
		);
		const modGuild = guildFor(memberWith([{permissions: {allow: 0n}}], [modRoleId]));
		expect(names(await modGuild.getCommands())).toEqual(["modonly"]);

		const plainGuild = guildFor(memberWith([{permissions: {allow: 0n}}], []));
		expect(names(await plainGuild.getCommands())).toEqual([]);
	});

	it("a command with permissions {roles:{[modRoleId]:true}, channels:{[deniedChannelId]:false}} is absent when getCommands is awaited with deniedChannelId and listed when asked with another channel id", async () => {
		captureRequests(
			INDEX,
			indexBody([
				command("1", "channelscoped", null, {
					roles: {[modRoleId]: true},
					channels: {[deniedChannelId]: false},
				}),
			]),
		);
		const guild = guildFor(memberWith([{permissions: {allow: 0n}}], [modRoleId]));
		expect(names(await guild.getCommands(deniedChannelId))).toEqual([]);
		expect(names(await guild.getCommands(otherChannelId))).toEqual(["channelscoped"]);
	});

	it("app owner bypasses permissions for commands of apps they own", async () => {
		captureRequests(
			INDEX,
			indexBody(
				[command("1", "owneronly", "0", {user: false})],
				[{id: "300", name: "Echo", owner_id: "me"}],
			),
		);
		const ownerGuild = guildFor(memberWith([{permissions: {allow: 0n}}]));
		expect(names(await ownerGuild.getCommands())).toEqual(["owneronly"]);

		const otherMember = memberWith([{permissions: {allow: 0n}}], undefined, "other");
		const otherGuild = guildFor(otherMember);
		expect(names(await otherGuild.getCommands())).toEqual([]);
	});
});

describe("per-command overrides: precedence against the existing gates", () => {
	const modRoleId = "901";

	it("an allow override lists the command even where default_member_permissions would not", async () => {
		captureRequests(
			INDEX,
			indexBody([command("1", "modonly", "8192", {roles: {[modRoleId]: true}})]),
		);
		const modGuild = guildFor(memberWith([{permissions: {allow: 0n}}], [modRoleId]));
		expect(names(await modGuild.getCommands())).toEqual(["modonly"]);

		const plainGuild = guildFor(memberWith([{permissions: {allow: 0n}}], []));
		expect(names(await plainGuild.getCommands())).toEqual([]);
	});

	it("@everyone rides in roleIds (the guild id): a guild-wide deny hides, a role allow carves out", async () => {
		captureRequests(
			INDEX,
			indexBody([
				command("1", "nobody", null, {roles: {[GUILD_ID]: false}}),
				command("2", "modsplus", null, {roles: {[GUILD_ID]: false, [modRoleId]: true}}),
			]),
		);
		const modGuild = guildFor(memberWith([{permissions: {allow: 0n}}], [modRoleId]));
		expect(names(await modGuild.getCommands())).toEqual(["modsplus"]);

		const plainGuild = guildFor(memberWith([{permissions: {allow: 0n}}], []));
		expect(names(await plainGuild.getCommands())).toEqual([]);
	});

	it("an ADMINISTRATOR passes a user:false deny that would hide them", async () => {
		captureRequests(
			INDEX,
			indexBody(
				[command("1", "nou", null, {user: false}), command("2", "owneronly", "0", {user: false})],
				[{id: "300", name: "Echo", owner_id: "someone-else"}],
			),
		);
		const adminGuild = guildFor(memberWith([{permissions: {allow: 1n << 3n}}]));
		expect(names(await adminGuild.getCommands())).toEqual(["nou", "owneronly"]);
	});

	it("cachedContextCommands applies the same overrides with channelId and owners", async () => {
		captureRequests(
			INDEX,
			indexBody([command("1", "ctxmod", null, {user: false, roles: {[modRoleId]: true}}, 3)]),
		);
		const modGuild = guildFor(memberWith([{permissions: {allow: 0n}}], [modRoleId]));
		await modGuild.getCommands();
		expect(names(modGuild.cachedContextCommands("801"))).toEqual(["ctxmod"]);

		const plainGuild = guildFor(memberWith([{permissions: {allow: 0n}}], []));
		await plainGuild.getCommands();
		expect(names(plainGuild.cachedContextCommands("801"))).toEqual([]);
	});
});
