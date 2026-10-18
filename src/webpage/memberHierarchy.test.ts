import {expect, it} from "vitest";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {Member} = await import("./member");
const {I18n} = await import("./i18n");
await I18n.done;

const GUILD = "1000";
const OWNER = "1";
const everyone = {id: GUILD, position: 0};
const mod = {id: "2001", position: 2};
const admin = {id: "2002", position: 5};

/** A moderator ("10", holding Mod, allowed every action) and a member holding `targetRoles`. */
function guildWith(
	targetRoles: {id: string; position: number}[],
	{meId = "10", targetId = "20", timedOut = false} = {},
) {
	const guild = {
		id: GUILD,
		properties: {owner_id: OWNER},
		roles: [admin, mod, everyone, ...targetRoles],
		member: undefined as unknown,
	};
	const make = (id: string, roles: {id: string}[], canModerate: boolean) =>
		Object.assign(Object.create(Member.prototype), {
			id,
			owner: guild,
			roleIds: new Set(roles.map((r) => r.id)),
			// The menu won't offer a timeout on a member who can moderate.
			hasPermission: () => canModerate,
			isAdmin: () => false,
			commuicationDisabledLeft: () => (timedOut ? 60_000 : 0),
		}) as MemberT;
	const me = make(meId, [mod], true);
	guild.member = me;
	const target = make(targetId, targetRoles, false);
	return {me, target};
}

/** Whether the user menu offers `label` on `target`, as seen by a user other than the target. */
function offered(label: string, target: MemberT) {
	const button = (
		User.contextmenu as unknown as {
			buttons: {text?: unknown; visible?: (this: unknown, m: unknown) => boolean}[];
		}
	).buttons.find((b) => typeof b.text === "function" && (b.text as () => string)() === label);
	const viewer = {id: target.id, localuser: {user: {id: "10"}}};
	return button?.visible?.call(viewer, target);
}

it("a member ranked at or above you can't be kicked, banned, timed out or renamed", () => {
	const {target} = guildWith([admin]);

	expect(offered(I18n.user.kick(), target)).toBe(false);
	expect(offered(I18n.user.ban(), target)).toBe(false);
	expect(offered(I18n.user.timeout(), target)).toBe(false);
	expect(offered(I18n.user.editNick(), target)).toBe(false);
	expect(offered(I18n.user.unTimeout(), guildWith([admin], {timedOut: true}).target)).toBe(false);
});

// A pin, not red-first: the old code offered these too.
it("a member ranked below you can be", () => {
	const {target} = guildWith([]);

	expect(offered(I18n.user.kick(), target)).toBe(true);
	expect(offered(I18n.user.ban(), target)).toBe(true);
	expect(offered(I18n.user.timeout(), target)).toBe(true);
	expect(offered(I18n.user.editNick(), target)).toBe(true);
	expect(offered(I18n.user.unTimeout(), guildWith([], {timedOut: true}).target)).toBe(true);
});

it("the server's rules: the owner can act on anyone, and nobody on the owner", () => {
	const {me, target} = guildWith([admin], {meId: OWNER});
	expect(me.canActOn(target)).toBe(true);

	const {me: someone, target: owner} = guildWith([], {targetId: OWNER});
	expect(someone.canActOn(owner)).toBe(false);
});

it("equal top roles: you can't act on a peer", () => {
	const {me, target} = guildWith([mod]);

	expect(me.canActOn(target)).toBe(false);
});

it("roles at the same position rank by id, the older (lower) one higher", () => {
	const older = guildWith([{id: "2000", position: 2}]);
	expect(older.me.canActOn(older.target)).toBe(false);
	const newer = guildWith([{id: "2003", position: 2}]);
	expect(newer.me.canActOn(newer.target)).toBe(true);
});
