import {expect, it} from "vitest";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Member} = await import("./member");
const {Channel} = await import("./channel");
const {Permissions} = await import("./permissions");

const GUILD = "1000";
const SEND = "3072"; // VIEW_CHANNEL + SEND_MESSAGES

/** A guild whose @everyone may send, with the viewer and another member; `timedOut` names who
 * is timed out. */
function guildWith(timedOut: "viewer" | "other") {
	const guild = {
		id: GUILD,
		roles: [{id: GUILD, permissions: new Permissions(SEND)}],
		member: undefined as unknown,
	};
	const later = new Date(Date.now() + 60_000);
	const make = (id: string, out: boolean) =>
		Object.assign(Object.create(Member.prototype), {
			id,
			owner: guild,
			roleIds: new Set<string>(),
			isAdmin: () => false,
			communication_disabled_until: out ? later : undefined,
		}) as MemberT;
	const viewer = make("10", timedOut === "viewer");
	const other = make("20", timedOut === "other");
	guild.member = viewer;
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: guild,
		type: 0,
		permission_overwrites: new Map(),
	}) as InstanceType<typeof Channel>;
	return {viewer, other, channel};
}

it("another member's permissions don't follow the viewer's timeout", () => {
	const {other, channel} = guildWith("viewer");

	expect(other.hasPermission("SEND_MESSAGES", false)).toBe(true);
	expect(channel.hasPermission("SEND_MESSAGES", other)).toBe(true);
});

it("a timed-out member's permissions show the timeout, whoever looks", () => {
	const {other, channel} = guildWith("other");

	expect(other.hasPermission("SEND_MESSAGES", false)).toBe(false);
	expect(channel.hasPermission("SEND_MESSAGES", other)).toBe(false);
});

// A pin, not red-first: the viewer's own timeout gated the viewer before too.
it("the viewer's own timeout still gates the viewer", () => {
	const {viewer, channel} = guildWith("viewer");

	expect(viewer.hasPermission("SEND_MESSAGES", false)).toBe(false);
	expect(channel.hasPermission("SEND_MESSAGES", viewer)).toBe(false);
});
