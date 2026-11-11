import {afterEach, describe, expect, it, vi} from "vitest";
import type {channeljson} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Group} = await import("./direct");
const {I18n} = await import("./i18n");
await I18n.done;

const ALICE = "1000000000000000001";
const BOB = "1000000000000000002";
const ME = "1000000000000000003";

/** A User-shaped member-list entry: only what the renderer touches. */
function listUser(id: string, name: string) {
	return {
		id,
		name,
		bot: false,
		bind: vi.fn(),
		buildstatuspfp: () => document.createElement("div"),
		subName: vi.fn(),
	};
}

/** The member-list row rendered for a user (its username is the row's text). */
function rowOf(side: HTMLElement, user: {name: string}) {
	return [...side.querySelectorAll<HTMLElement>(".memberListStyle")].find((row) =>
		row.textContent?.includes(user.name),
	);
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("a group DM's owner crown", () => {
	it("follows the new owner on reused rows when the update moves ownership", () => {
		const alice = listUser(ALICE, "Alice");
		const bob = listUser(BOB, "Bob");
		const me = listUser(ME, "Meidnight");
		const group = Object.assign(Object.create(Group.prototype), {
			id: "dm1",
			// `guild` and `localuser` are getters on the prototype: they read through `owner`.
			owner: {id: "@me"},
			users: [alice, bob],
			owner_id: ALICE,
		}) as InstanceType<typeof Group>;
		const lu = Object.assign(Object.create(Localuser.prototype), {
			channelfocus: group,
			// Class fields, so Object.create alone doesn't make them.
			roleListMap: new WeakMap(),
		}) as InstanceType<typeof Localuser>;
		const side = document.createElement("div");
		side.id = "sideDiv";
		document.body.append(side);
		const elms = new Map([["online" as const, [alice, bob, me] as never]]);

		lu.generateListHTML(elms, group);
		expect(rowOf(side, alice)?.querySelector(".svg-crown")).not.toBeNull();
		expect(rowOf(side, bob)?.querySelector(".svg-crown")).toBeNull();

		// The owner leaves; the server crowns the lowest remaining recipient (Bob), and the
		// CHANNEL_UPDATE carrying it must move the crown on rows that already rendered.
		group.owner_id = BOB;
		lu.generateListHTML(elms, group);

		expect(rowOf(side, bob)?.querySelector(".svg-crown")).not.toBeNull();
		expect(rowOf(side, alice)?.querySelector(".svg-crown")).toBeNull();
	});
});

/** A group DM with only what updateChannel reads, focused or not in a stubbed localuser. */
function groupDM(focused: boolean) {
	const span = document.createElement("span");
	span.textContent = "Alice, Bob";
	const memberListQue = vi.fn();
	const localuser = {
		channelfocus: undefined as unknown,
		memberListQue,
		channelids: new Map(),
		roleids: new Map(),
	};
	const group = Object.assign(Object.create(Group.prototype), {
		id: "dm1",
		guild_id: "@me",
		name: "Alice, Bob",
		users: [{name: "Alice"}, {name: "Bob"}],
		// `guild` and `localuser` are getters on the prototype: they read through `owner`.
		owner: {localuser},
		nameSpan: new WeakRef(span),
		all: new WeakRef(document.createElement("div")),
		permission_overwrites: new Map(),
		renderIcon: () => {},
		makeIcon: () => document.createElement("div"),
		fireEvents: () => {},
		// Only the focused branch of Channel.updateChannel calls these; none is under test.
		slowmode: vi.fn(),
		refreshComposerLock: vi.fn(),
	}) as InstanceType<typeof Group>;
	localuser.channelfocus = focused ? group : {id: "other"};
	return {group, memberListQue, span};
}

const update = {id: "dm1", type: 3, icon: "newicon", owner_id: BOB} as unknown as channeljson;

describe("a focused group DM's update", () => {
	it("queues a member-list redraw so the owner-only UI follows the new owner", () => {
		const {group, memberListQue} = groupDM(true);

		group.updateChannel(update);

		expect(memberListQue).toHaveBeenCalledTimes(1);
	});

	it("an unfocused group DM leaves the open channel's member list alone", () => {
		const {group, memberListQue} = groupDM(false);

		group.updateChannel(update);

		expect(memberListQue).not.toHaveBeenCalled();
	});
});
