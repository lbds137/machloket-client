import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Member} = await import("./member");
const {Channel} = await import("./channel");
const {Permissions} = await import("./permissions");

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

const USE_APPLICATION_COMMANDS = 1n << 31n;

/** A member whose roles are `roles` (the Member.roles getter, shadowed as the fixtures do),
 * plus the USE_APPLICATION_COMMANDS every default @everyone carries: the cases below are about
 * what comes after that gate. */
function memberWith(roles: {permissions: {allow: bigint}}[], roleIds?: string[], userId = "me") {
	const member = Object.create(Member.prototype);
	Object.defineProperty(member, "roles", {
		value: [...roles, {permissions: {allow: USE_APPLICATION_COMMANDS}}],
	});
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
			channelids: new Map(),
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
		// (memberWith adds USE_APPLICATION_COMMANDS.)
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

// The server refuses a command before it reads the command at all: 50013 without
// USE_APPLICATION_COMMANDS in that channel (ADMINISTRATOR and the guild owner hold every bit),
// 50083 in an archived thread, for everyone.
describe("the channel's own gates, ahead of every per-command rule", () => {
	const CHANNEL_ID = "801";
	const THREAD_ID = "802";
	const USE = USE_APPLICATION_COMMANDS.toString();
	const VIEW = (1n << 10n).toString();
	const VIEW_AND_USE = ((1n << 10n) | USE_APPLICATION_COMMANDS).toString();

	/** Real roles, a real Member and real Channels: Channel.hasPermission walks them all. */
	function guildWithChannel(
		everyone: string,
		{
			overwrite,
			userId = "me",
			ownerId = "someone-else",
		}: {overwrite?: {allow?: string; deny?: string}; userId?: string; ownerId?: string} = {},
	) {
		const guild = guildFor();
		guild.properties = {owner_id: ownerId} as never;
		const member = Object.create(Member.prototype);
		Object.defineProperty(member, "roles", {
			value: [{id: GUILD_ID, permissions: new Permissions(everyone)}],
		});
		Object.defineProperty(member, "user", {value: {id: userId}});
		Object.defineProperty(member, "guild", {value: guild});
		member.id = userId;
		member.roleIds = new Set<string>();
		guild.member = member as never;

		const overwrites = new Map<string, InstanceType<typeof Permissions>>();
		if (overwrite) {
			overwrites.set(GUILD_ID, new Permissions(overwrite.allow ?? "0", overwrite.deny ?? "0"));
		}
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: CHANNEL_ID,
			type: 0,
			owner: guild,
			permission_overwrites: overwrites,
		});
		guild.localuser.channelids.set(CHANNEL_ID, channel);
		return {guild, channel};
	}

	/** A thread of `channel`, with its own metadata. */
	function addThread(guild: InstanceType<typeof Guild>, channel: unknown, archived: boolean) {
		const thread = Object.assign(Object.create(Channel.prototype), {
			id: THREAD_ID,
			type: 11,
			owner: guild,
			parent: channel,
			permission_overwrites: new Map(),
			threadData: {archived},
		});
		guild.localuser.channelids.set(THREAD_ID, thread);
	}

	const index = (
		commands: ReturnType<typeof command>[] = [command("1", "random")],
		applications?: {id: string; name: string; owner_id?: string}[],
	) => captureRequests(INDEX, indexBody(commands, applications));

	it("a channel overwrite denying the bit hides the commands there, and only there", async () => {
		index();
		const {guild} = guildWithChannel(VIEW_AND_USE, {overwrite: {deny: USE}});
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual([]);
		// A channel this client doesn't hold falls back on the member's role bits.
		expect(names(await guild.getCommands("elsewhere"))).toEqual(["random"]);
	});

	it("a channel overwrite granting the bit shows them to a member whose roles lack it", async () => {
		index();
		const {guild} = guildWithChannel(VIEW, {overwrite: {allow: USE}});
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual(["random"]);
	});

	it("an app's owner without the bit doesn't see its commands", async () => {
		index([command("1", "mine")], [{id: "300", name: "Echo", owner_id: "me"}]);
		const {guild} = guildWithChannel(VIEW);
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual([]);
	});

	it("a per-command allow doesn't stand in for the bit", async () => {
		index([
			command("1", "byrole", null, {roles: {[GUILD_ID]: true}}),
			command("2", "byuser", null, {user: true}),
			command("3", "bychannel", null, {channels: {[CHANNEL_ID]: true}}),
		]);
		const {guild} = guildWithChannel(VIEW);
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual([]);
	});

	it("ADMINISTRATOR and the guild owner pass without the bit", async () => {
		index();
		const admin = guildWithChannel(((1n << 3n) | (1n << 10n)).toString()).guild;
		expect(names(await admin.getCommands(CHANNEL_ID))).toEqual(["random"]);

		index();
		const owner = guildWithChannel(VIEW, {ownerId: "me"}).guild;
		expect(names(await owner.getCommands(CHANNEL_ID))).toEqual(["random"]);
	});

	it("a message's Apps menu follows the same gate", async () => {
		index([command("1", "ctx", null, null, 3)]);
		const {guild} = guildWithChannel(VIEW_AND_USE, {overwrite: {deny: USE}});
		await guild.getCommands(CHANNEL_ID);
		expect(names(guild.cachedContextCommands(CHANNEL_ID))).toEqual([]);
	});

	it("with no channel at all, the member's role bits decide", async () => {
		index();
		const {guild} = guildWithChannel(VIEW);
		expect(names(await guild.getCommands())).toEqual([]);
	});

	it("a thread takes the bit from its parent", async () => {
		index();
		const {guild, channel} = guildWithChannel(VIEW_AND_USE, {overwrite: {deny: USE}});
		addThread(guild, channel, false);
		expect(names(await guild.getCommands(THREAD_ID))).toEqual([]);
	});

	it("a timed-out member sees none, in a channel this client holds or not", async () => {
		index();
		const {guild} = guildWithChannel(VIEW_AND_USE);
		(guild.member as unknown as {communication_disabled_until: Date}).communication_disabled_until =
			new Date(Date.now() + 60_000);
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual([]);
		expect(names(await guild.getCommands("elsewhere"))).toEqual([]);
		expect(names(await guild.getCommands())).toEqual([]);
	});

	it("an archived thread offers no commands before the member has resolved", async () => {
		index();
		const {guild, channel} = guildWithChannel(VIEW_AND_USE);
		addThread(guild, channel, true);
		delete (guild as {member?: unknown}).member;
		expect(names(await guild.getCommands(THREAD_ID))).toEqual([]);
		// Nothing else can be filtered yet: the rest of the list stands.
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual(["random"]);
	});

	it("an archived thread offers no commands, to an admin neither", async () => {
		index([command("1", "random"), command("2", "ctx", null, null, 3)]);
		const {guild, channel} = guildWithChannel(((1n << 3n) | (1n << 10n)).toString());
		addThread(guild, channel, true);
		expect(names(await guild.getCommands(THREAD_ID))).toEqual([]);
		expect(names(guild.cachedContextCommands(THREAD_ID))).toEqual([]);
		// Its parent, and an open thread, are unaffected.
		expect(names(await guild.getCommands(CHANNEL_ID))).toEqual(["random"]);
		addThread(guild, channel, false);
		expect(names(await guild.getCommands(THREAD_ID))).toEqual(["random"]);
	});
});
