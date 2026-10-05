import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Role, RoleList} = await import("./role");
const {Dialog, Options} = await import("./settings");

const API = "http://roles.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

function guildWith() {
	const guild = {
		id: "g1",
		headers: {},
		info: {api: API},
		member: {id: "me", hasPermission: () => true, roles: [] as unknown[]},
		properties: {owner_id: "someone"},
	};
	const role = (id: string, position: number) =>
		Object.assign(Object.create(Role.prototype), {
			id,
			name: "r" + id,
			position,
			owner: guild,
			info: guild.info,
		}) as InstanceType<typeof Role>;
	guild.member.roles.push(role("g1", 0), role("50", 5));
	return {guild, role};
}

function listOf(guild: object, roles: InstanceType<typeof Role>[]) {
	return Object.assign(Object.create(RoleList.prototype), {
		guild,
		permissions: roles.map((r) => [r, {}]),
		options: {generateHTML: () => document.createElement("div"), name: ""},
		permission: {},
		htmlarea: new WeakRef(document.createElement("div")),
	}) as InstanceType<typeof RoleList>;
}

it("a refused role delete says so and leaves the role open", async () => {
	captureRequests(API + "/guilds/g1/roles/7", () => new Response(null, {status: 403}));
	const {guild, role} = guildWith();
	const doomed = role("7", 1);
	const list = listOf(guild, [doomed, role("8", 2)]);
	list.curid = "7";
	const buttons = vi.spyOn(Options.prototype, "addButtonInput");
	const texts = vi.spyOn(Options.prototype, "addText");
	const hidden = vi.spyOn(Dialog.prototype, "hide");
	const moved = vi.spyOn(list, "generateHTMLArea").mockReturnValue(document.createElement("div"));

	list.deleteRole(doomed);
	await (buttons.mock.calls[0][2] as () => Promise<void>)();

	expect(texts.mock.calls.map((c) => c[0])).toContainEqual(expect.stringContaining("403"));
	expect(hidden).not.toHaveBeenCalled();
	expect(moved).not.toHaveBeenCalled();
});

it("the header's delete button hides for @everyone and for roles one can't manage", () => {
	const {guild, role} = guildWith();
	const everyone = guild.member.roles[0] as InstanceType<typeof Role>;
	const above = role("90", 9);
	const below = role("20", 2);
	const list = listOf(guild, [everyone, above, below]);
	const button = document.createElement("button");
	list.deleteButton = button;

	list.handleString("g1");
	expect(button.hidden).toBe(true);
	list.handleString("90");
	expect(button.hidden).toBe(true);
	list.handleString("20");
	expect(button.hidden).toBe(false);
});
