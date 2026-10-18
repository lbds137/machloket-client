import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Permissions} = await import("./permissions");

const GUILD = "g1";
const bits = (...names: string[]) =>
	names.reduce(
		(total, name) => total | (1n << BigInt(Permissions.permisions.indexOf(name as never))),
		0n,
	) + "";
const role = (id: string, ...names: string[]) => ({
	id,
	permissions: new Permissions(bits(...names)),
});
const overwrite = (allow: string[], deny: string[]) =>
	new Permissions(bits(...allow), bits(...deny));

/** A member with roles Mod (higher) and Helper over @everyone (which can view and send), in a
 * text channel with the given overwrites (their storage order doesn't matter). */
function channelWith(
	overwrites: [string, InstanceType<typeof Permissions>][],
	everyoneExtra: string[] = [],
) {
	const member = {
		id: "u1",
		isAdmin: () => false,
		commuicationDisabledLeft: () => 0,
		roles: [
			role("mod"),
			role("helper"),
			role(GUILD, "VIEW_CHANNEL", "SEND_MESSAGES", ...everyoneExtra),
		],
	};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		type: 0,
		// `guild` is a getter on the prototype: it reads the owner.
		owner: {id: GUILD, member},
		permission_overwrites: new Map(overwrites),
	}) as InstanceType<typeof Channel>;
	return channel;
}

it("conflicting role overwrites: an allow on any of the member's roles wins", () => {
	const channel = channelWith([
		["mod", overwrite([], ["VIEW_CHANNEL"])],
		["helper", overwrite(["VIEW_CHANNEL"], [])],
		[GUILD, overwrite([], ["VIEW_CHANNEL"])],
	]);

	expect(channel.hasPermission("VIEW_CHANNEL")).toBe(true);
});

// A pin, not red-first: the old code did this too.
it("a role overwrite's deny with no role allowing removes what @everyone has", () => {
	const channel = channelWith([["mod", overwrite([], ["SEND_MESSAGES"])]]);

	expect(channel.hasPermission("SEND_MESSAGES")).toBe(false);
});

// A pin, not red-first: the old code did this too.
it("the member's own overwrite wins over every role overwrite", () => {
	const channel = channelWith([
		["helper", overwrite(["VIEW_CHANNEL"], [])],
		["u1", overwrite([], ["VIEW_CHANNEL"])],
	]);

	expect(channel.hasPermission("VIEW_CHANNEL")).toBe(false);
});

it("a member who can't see the channel holds nothing in it", () => {
	const channel = channelWith([[GUILD, overwrite([], ["VIEW_CHANNEL"])]]);

	expect(channel.hasPermission("SEND_MESSAGES")).toBe(false);
});

it("without the right to send, attaching files is lost too", () => {
	const channel = channelWith([[GUILD, overwrite([], ["SEND_MESSAGES"])]], ["ATTACH_FILES"]);

	expect(channel.hasPermission("ATTACH_FILES")).toBe(false);
});

it("in a thread, the bits that qualify a message follow the right to send in threads", () => {
	const parent = channelWith(
		[[GUILD, overwrite([], ["SEND_MESSAGES"])]],
		["SEND_MESSAGES_IN_THREADS", "ATTACH_FILES"],
	);
	const thread = Object.assign(Object.create(Channel.prototype), {
		id: "t1",
		type: 11,
		owner: parent.guild,
		parent,
	}) as InstanceType<typeof Channel>;

	expect(parent.hasPermission("ATTACH_FILES")).toBe(false);
	expect(thread.hasPermission("ATTACH_FILES")).toBe(true);
});

it("an overwrite can't grant ADMINISTRATOR", () => {
	const channel = channelWith([[GUILD, overwrite(["ADMINISTRATOR"], [])]]);

	expect(channel.hasPermission("ADMINISTRATOR")).toBe(false);
});
