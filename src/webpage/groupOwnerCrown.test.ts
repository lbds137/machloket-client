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

/** Alice owns the group, Bob and Meidnight follow, and the member list has rendered once. */
function crownScene() {
	const alice = listUser(ALICE, "Alice");
	const bob = listUser(BOB, "Bob");
	const me = listUser(ME, "Meidnight");
	const lu = Object.assign(Object.create(Localuser.prototype), {
		channelfocus: undefined as unknown,
		// Class fields, so Object.create alone doesn't make them.
		roleListMap: new WeakMap(),
		channelids: new Map(),
	}) as InstanceType<typeof Localuser>;
	const group = Object.assign(Object.create(Group.prototype), {
		id: "dm1",
		// `guild` and `localuser` are getters on the prototype: they read through `owner`.
		owner: {id: "@me", localuser: lu},
		users: [alice, bob],
		owner_id: ALICE,
		// updateChannel's icon/event path and Channel's focused branch touch these; no crown
		// test inspects them (same stubs as the groupDM harness below).
		nameSpan: new WeakRef(document.createElement("span")),
		all: new WeakRef(document.createElement("div")),
		permission_overwrites: new Map(),
		makeIcon: () => document.createElement("div"),
		renderIcon: () => {},
		fireEvents: () => {},
		slowmode: vi.fn(),
		refreshComposerLock: vi.fn(),
	}) as InstanceType<typeof Group>;
	lu.channelfocus = group;
	const side = document.createElement("div");
	side.id = "sideDiv";
	document.body.append(side);
	const elms = new Map([["online" as const, [alice, bob, me] as never]]);
	return {alice, bob, group, lu, side, elms};
}

describe("a group DM's owner crown", () => {
	it("follows the new owner on reused rows when the update moves ownership", () => {
		const {alice, bob, group, lu, side, elms} = crownScene();

		lu.generateListHTML(elms, group);
		const aliceRow = rowOf(side, alice);
		expect(aliceRow?.querySelector(".svg-crown")).not.toBeNull();
		expect(rowOf(side, bob)?.querySelector(".svg-crown")).toBeNull();

		// The owner leaves; the server crowns the lowest remaining recipient (Bob), and the
		// CHANNEL_UPDATE carrying it must move the crown on rows that already rendered.
		group.owner_id = BOB;
		lu.generateListHTML(elms, group);

		// The second render reused the first render's rows — the premise this test covers.
		expect(rowOf(side, alice)).toBe(aliceRow);
		expect(rowOf(side, bob)?.querySelector(".svg-crown")).not.toBeNull();
		expect(rowOf(side, alice)?.querySelector(".svg-crown")).toBeNull();
	});

	it("a partial update without owner_id does not reset ownership or strip the crown", () => {
		const {alice, bob, group, lu, side, elms} = crownScene();

		lu.generateListHTML(elms, group);

		// owner_id is optional in channeljson: an event that omits it carries no ownership
		// change, and nothing else in the client may read this reset as one.
		group.updateChannel({id: "dm1", type: 3} as unknown as channeljson);

		expect(group.owner_id).toBe(ALICE);
		lu.generateListHTML(elms, group);
		expect(rowOf(side, alice)?.querySelector(".svg-crown")).not.toBeNull();
		expect(rowOf(side, bob)?.querySelector(".svg-crown")).toBeNull();
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
