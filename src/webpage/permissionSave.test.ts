import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");
const {Channel} = await import("./channel");
const {Permissions} = await import("./permissions");
const {Dialog} = await import("./settings");
const {PermissionToggle, RoleList} = await import("./role");

const API = "http://perms.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

/** A guild holding role r1 (permissions 1, an icon) as the role editor saves it. */
function guildWithRole() {
	const role = {
		id: "r1",
		name: "Mods",
		icon: "iconhash",
		color: 0,
		permissions: new Permissions("1"),
	};
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {},
		roleids: new Map([["r1", role]]),
		owner: {info: {api: API}},
	}) as InstanceType<typeof Guild>;
	return {guild, role};
}

it("a role's permissions save sends only the permissions", async () => {
	const sent = captureRequests(API + "/guilds/g1/roles/r1", () => Response.json({}));
	const {guild, role} = guildWithRole();

	await guild.updateRolePermissions("r1", new Permissions("8"));

	// Not the icon's hash (the server would take it for an upload) nor the other fields.
	expect(sent).toEqual([{permissions: "8"}]);
	expect(role.permissions.allow).toBe(8n);
});

it("a refused role permissions save says so and keeps the role as it was", async () => {
	captureRequests(API + "/guilds/g1/roles/r1", () => new Response(null, {status: 403}));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const {guild, role} = guildWithRole();

	await guild.updateRolePermissions("r1", new Permissions("8"));

	expect(role.permissions.allow).toBe(1n);
	expect(shown).toHaveBeenCalled();
});

it("a refused channel overwrite save says so and keeps the overwrite as it was", async () => {
	captureRequests(API + "/channels/c1/permissions/r1", () => new Response(null, {status: 403}));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const overwrite = new Permissions("1", "2");
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {},
		permission_overwrites: new Map([["r1", overwrite]]),
		owner: {info: {api: API}, localuser: {userMap: new Map()}},
	}) as InstanceType<typeof Channel>;

	await channel.updateRolePermissions("r1", new Permissions("8", "4"));

	expect([overwrite.allow, overwrite.deny]).toEqual([1n, 2n]);
	expect(shown).toHaveBeenCalled();
});

it("opening another role while a save is in flight doesn't give the saved role its bits", async () => {
	let answer!: () => void;
	captureRequests(
		API + "/guilds/g1/roles/r1",
		() => new Promise<Response>((res) => (answer = () => res(Response.json({})))),
	);
	const {guild, role} = guildWithRole();
	// The editor's one permissions object, reloaded when another role is opened.
	const editing = new Permissions("8");

	const saving = guild.updateRolePermissions("r1", editing);
	await vi.waitFor(() => expect(answer).toBeDefined());
	editing.allow = 64n;
	answer();
	await saving;

	expect(role.permissions.allow).toBe(8n);
});

/** A RoleList-shaped editor over one stored role pair, with a real toggle row attached. */
function editorOf(
	stored: InstanceType<typeof Permissions>,
	editing: InstanceType<typeof Permissions>,
) {
	const list = Object.assign(Object.create(RoleList.prototype), {
		curid: "r1",
		permission: editing,
		permissions: [[{id: "r1", name: "Mods"}, stored]],
		onchange: () => undefined,
		options: {subOptions: undefined, haschanged: true, changed: () => {}},
		permToggles: [],
	}) as InstanceType<typeof RoleList>;
	const toggle = new PermissionToggle(
		{name: "VIEW_CHANNEL", readableName: "View channel", description: ""},
		editing,
		list.options,
	);
	list.permToggles.push(toggle);
	const button = toggle.generateHTML().querySelector("button")!;
	return {list, toggle, button};
}

it("a refused save puts the editor back on the stored bits", async () => {
	captureRequests(API + "/guilds/g1/roles/r1", () => new Response(null, {status: 403}));
	const {guild} = guildWithRole();
	const stored = new Permissions("1");
	const editing = new Permissions("1");
	const {list, button} = editorOf(stored, editing);
	list.onchange = guild.updateRolePermissions.bind(guild);

	button.click();
	expect(editing.getPermission("VIEW_CHANNEL")).toBe(1);

	await list.save();

	expect(editing.getPermission("VIEW_CHANNEL")).toBe(0);
	expect(editing.allow).toBe(1n);
	expect(button.classList.contains("active")).toBe(false);
	expect(list.options.haschanged).toBe(false);
});

it("an edit made while a refused save is in flight isn't reverted", async () => {
	let release!: (v: boolean) => void;
	const stored = new Permissions("1");
	const editing = new Permissions("1");
	const {list, button} = editorOf(stored, editing);
	list.onchange = () =>
		new Promise<boolean>((res) => {
			release = res;
		});

	button.click();
	const saving = list.save();
	// Newer than the refused save: the revert must not stomp it.
	editing.setPermission("SEND_MESSAGES", 1);
	release(false);
	await saving;

	expect(editing.getPermission("SEND_MESSAGES")).toBe(1);
	expect(editing.getPermission("VIEW_CHANNEL")).toBe(1);
	expect(list.options.haschanged).toBe(true);
});
