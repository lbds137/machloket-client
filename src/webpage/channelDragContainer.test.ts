import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Channel} = await import("./channel");
const {Member} = await import("./member");
const {Permissions} = await import("./permissions");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://drag.test/api/v9";
const CHANNELS = API + "/guilds/g1/channels";

afterEach(() => {
	Channel.dragged = [];
	document.body.replaceChildren();
});

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		guildids: new Map(),
		lookingguild: undefined,
		searching: false,
		// Channel.perminfo walks userinfo.localuserStore; perminfo itself is accessor-only.
		userinfo: {localuserStore: {guilds: {}, channels: {}}},
	}) as InstanceType<typeof Localuser>;
}

function guild(lu = localuser()) {
	const g = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels: [],
		headchannels: [],
		owner: lu,
		properties: {name: "g"},
		html: document.createElement("div"),
	}) as InstanceType<typeof Guild>;
	// The real constructor seeds this; Channel's constructor reads it.
	g.perminfo = {channels: {}};
	lu.guildids.set("g1", g);
	// The restore only rebuilds the guild the user is looking at.
	lu.lookingguild = g;
	return g;
}

function chan(
	g: InstanceType<typeof Guild>,
	id: string,
	{
		type = 0,
		position = 0,
		parent = undefined as InstanceType<typeof Channel> | undefined,
		real = false,
	} = {},
) {
	const c = Object.assign(Object.create(Channel.prototype), {
		id,
		name: "chan-" + id,
		headers: {Authorization: "t"},
		owner: g,
		type,
		position,
		parent,
		parent_id: parent ? parent.id : null,
		children: [],
		permission_overwrites: new Map(),
		// Class fields don't initialize on Object.create; the real row builder derefs these.
		iconElm: new WeakRef(document.createElement("span")),
	}) as InstanceType<typeof Channel>;
	if (!real) {
		// The row DOM is not what these tests vary; the id is all the rebuild assertions need.
		c.createguildHTML = () => {
			const d = document.createElement("div");
			d.textContent = id;
			return d;
		};
	}
	return c;
}

const bits = (...names: string[]) =>
	names.reduce(
		(total, name) => total | (1n << BigInt(Permissions.permisions.indexOf(name as never))),
		0n,
	) + "";

/** A guild whose member holds exactly `perms` (owner overrides via ownerId === "u1"). */
function memberGuild(perms: string[], ownerId = "u2") {
	const g = guild();
	g.properties.owner_id = ownerId;
	const member = Object.assign(Object.create(Member.prototype), {
		id: "u1",
		owner: g,
		user: {id: "u1"},
	}) as MemberT;
	Object.defineProperty(member, "roles", {
		value: [{id: "r1", position: 1, permissions: new Permissions(bits(...perms))}],
	});
	g.member = member;
	return {g, member};
}

/** A drop event over the bottom half of the row (the container branch). */
function dropBottomHalf() {
	const drop = new Event("drop");
	Object.defineProperty(drop, "offsetY", {value: 5});
	return drop;
}

/** A drop event over the top half of the row (before=true even at height 0). */
function dropTopHalf() {
	const drop = new Event("drop");
	Object.defineProperty(drop, "offsetY", {value: -5});
	return drop;
}

type ReorderRow = {id: string; position?: number; parent_id?: string | null};

it("a top-level channel dropped onto a category header leaves the top level exactly once", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const cat = chan(g, "cat", {type: 4, position: 0});
	const kid = chan(g, "kid", {position: 0, parent: cat});
	cat.children = [kid];
	const c = chan(g, "c", {position: 1});
	g.headchannels = [cat, c];
	g.channels = [cat, c, kid];

	const div = document.createElement("div");
	const containerDiv = document.createElement("div");
	cat.coatDropDiv(div, containerDiv);
	Channel.dragged = [c, document.createElement("div")];
	div.dispatchEvent(dropBottomHalf());
	Channel.dragged = [];

	// Single membership: inside the category, OUT of the top level.
	expect(cat.children.map((ch) => ch.id)).toEqual(["c", "kid"]);
	expect(g.headchannels.map((ch) => ch.id)).toEqual(["cat"]);
	await vi.waitFor(() => expect(sent).toHaveLength(1));
	// The walked-twice channel must produce one PATCH row, not two.
	const rows = sent[0] as ReorderRow[];
	expect(rows.filter((r) => r.id === "c")).toHaveLength(1);
	// And that row must carry the container drop's parent.
	expect(rows.find((r) => r.id === "c")?.parent_id).toBe("cat");
});

it("moveInto maintains parent_id across moves (the merge's invariant)", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const cat = chan(g, "cat", {type: 4, position: 0});
	const c = chan(g, "c", {position: 0, parent: cat});
	cat.children = [c];
	g.headchannels = [cat];
	g.channels = [cat, c];

	// Out to top level, then back into the same category before any gateway echo.
	expect(c.moveInto(null)).toBe(true);
	expect(c.parent_id).toBeNull();
	expect(c.moveInto(cat)).toBe(true);
	expect(c.parent_id).toBe("cat");

	// Coverage pin: the sent row still carries the explicit parent either way.
	await g.calculateReorder("c");
	await vi.waitFor(() => expect(sent).toHaveLength(1));
	const rows = sent[0] as ReorderRow[];
	expect(rows.find((r) => r.id === "c")?.parent_id).toBe("cat");
});

it("a stale parent_id cannot survive a top-level sibling drop", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const a = chan(g, "a", {position: 0});
	const b = chan(g, "b", {position: 1});
	const c = chan(g, "c", {position: 2});
	// The un-echoed state moveInto(null) leaves behind today: parent null, parent_id stale.
	c.parent_id = "catA";
	g.headchannels = [a, b, c];
	g.channels = [a, b, c];

	const wrap = document.createElement("div");
	const div = document.createElement("div");
	wrap.append(div);
	document.body.append(wrap);
	b.coatDropDiv(div);
	Channel.dragged = [c, document.createElement("div")];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	// The sibling-drop branch must maintain the field itself: move_id is undefined on
	// this path, so calculateReorder's merge never runs for c.
	expect(c.parent_id).toBeNull();
	await vi.waitFor(() => expect(sent).toHaveLength(1));
});

it("MANAGE_CHANNELS members can drag rows through buildChannelList", () => {
	const {g} = memberGuild(["VIEW_CHANNEL", "MANAGE_CHANNELS"]);
	const c = chan(g, "c", {position: 0, real: true});
	g.headchannels = [c];
	g.channels = [c];

	const list = g.buildChannelList();
	expect((list.firstElementChild as HTMLElement).draggable).toBe(true);
});

it("plain members cannot drag; admins keep it", () => {
	const plain = memberGuild(["VIEW_CHANNEL"]);
	const c = chan(plain.g, "c", {position: 0, real: true});
	plain.g.headchannels = [c];
	plain.g.channels = [c];
	expect((plain.g.buildChannelList().firstElementChild as HTMLElement).draggable).toBe(false);

	const admin = memberGuild([], "u1"); // owner_id === the member's user id
	const a = chan(admin.g, "a", {position: 0, real: true});
	admin.g.headchannels = [a];
	admin.g.channels = [a];
	expect((admin.g.buildChannelList().firstElementChild as HTMLElement).draggable).toBe(true);
});

it("MANAGE_CHANNELS members get working sibling drop targets, not just draggable rows", () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const {g} = memberGuild(["VIEW_CHANNEL", "MANAGE_CHANNELS"]);
	const a = chan(g, "a", {position: 0, real: true});
	const b = chan(g, "b", {position: 1, real: true});
	const c = chan(g, "c", {position: 2, real: true});
	g.headchannels = [a, b, c];
	g.channels = [a, b, c];

	const list = g.buildChannelList();
	// Rows render in headchannels order: drop c onto b's row, top half.
	const rowB = list.children[1] as HTMLElement;
	Channel.dragged = [c, document.createElement("div")];
	rowB.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	// The synchronous model half: the drop handler must actually run on this row.
	expect(g.headchannels.map((ch) => ch.id)).toEqual(["a", "c", "b"]);
	return vi.waitFor(() => expect(sent).toHaveLength(1));
});

it("a sibling drop inside a category keeps the category's parent_id row", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const cat = chan(g, "cat", {type: 4, position: 0});
	const k1 = chan(g, "k1", {position: 0, parent: cat});
	const k2 = chan(g, "k2", {position: 1, parent: cat});
	cat.children = [k1, k2];
	const top = chan(g, "top", {position: 1});
	g.headchannels = [cat, top];
	g.channels = [cat, k1, k2, top];

	// Drop k2 onto k1 inside the same category.
	const wrap = document.createElement("div");
	const div = document.createElement("div");
	wrap.append(div);
	document.body.append(wrap);
	k1.coatDropDiv(div);
	Channel.dragged = [k2, document.createElement("div")];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	expect(cat.children.map((ch) => ch.id)).toEqual(["k2", "k1"]);
	expect(k2.parent_id).toBe("cat");
	await vi.waitFor(() => expect(sent).toHaveLength(1));
});

it("a dragged channel missing from every list cannot splice out a bystander", () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const a = chan(g, "a", {position: 0});
	const b = chan(g, "b", {position: 1});
	const ghost = chan(g, "ghost", {position: 2});
	g.headchannels = [a, b];
	g.channels = [a, b];

	const wrap = document.createElement("div");
	const div = document.createElement("div");
	wrap.append(div);
	document.body.append(wrap);
	b.coatDropDiv(div);
	Channel.dragged = [ghost, document.createElement("div")];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	// The insertion still happens, but nothing already in the list may vanish.
	expect(g.headchannels.map((ch) => ch.id)).toEqual(["a", "ghost", "b"]);
	return vi.waitFor(() => expect(sent).toHaveLength(1));
});

it("a consumed drop leaves no move_id to resurrect after a gateway move", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const catX = chan(g, "catX", {type: 4, position: 0});
	const catY = chan(g, "catY", {type: 4, position: 1});
	const c = chan(g, "c", {position: 0});
	g.headchannels = [catX, catY];
	g.channels = [catX, catY, c];

	// 1. The user container-drops c into catX; the reorder consumes the move.
	const div = document.createElement("div");
	const containerDiv = document.createElement("div");
	catX.coatDropDiv(div, containerDiv);
	Channel.dragged = [c, document.createElement("div")];
	div.dispatchEvent(dropBottomHalf());
	Channel.dragged = [];
	await vi.waitFor(() => expect(sent).toHaveLength(1));
	expect(c.move_id).toBeUndefined();

	// 2. Another admin moves c into catY; the gateway echo lands.
	c.parent = catY;
	c.parent_id = "catY";
	catX.children = catX.children.filter((ch) => ch !== c);
	catY.children.push(c);

	// 3. An unrelated reorder pass must not write the old move back.
	await g.calculateReorder();
	expect(c.parent_id).toBe("catY");
});
