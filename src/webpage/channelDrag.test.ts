import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Channel} = await import("./channel");
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
	} = {},
) {
	const c = Object.assign(Object.create(Channel.prototype), {
		id,
		headers: {Authorization: "t"},
		owner: g,
		type,
		position,
		parent,
		parent_id: parent ? parent.id : null,
		children: [],
	}) as InstanceType<typeof Channel>;
	// The row DOM is not what these tests vary; the id is all the rebuild assertions need.
	c.createguildHTML = () => {
		const d = document.createElement("div");
		d.textContent = id;
		return d;
	};
	return c;
}

/** A drop event over the top half of the row (before=true even at height 0). */
function dropTopHalf() {
	const drop = new Event("drop");
	Object.defineProperty(drop, "offsetY", {value: -5});
	return drop;
}

it("a refused drag's layout restore rebuilds the channels and keeps the search panel", () => {
	const g = guild();
	g.localuser.searching = true;
	const side = document.createElement("div");
	side.id = "sideContainDiv";
	side.classList.add("searchDiv");
	const searchBox = document.createElement("div");
	searchBox.id = "searchBox";
	searchBox.textContent = "stale";
	const serverName = document.createElement("div");
	serverName.id = "serverName";
	const servertd = document.createElement("div");
	servertd.id = "servertd";
	const channels = document.createElement("div");
	channels.id = "channels";
	document.body.append(side, searchBox, serverName, servertd, channels);

	const a = chan(g, "a", {position: 0});
	const b = chan(g, "b", {position: 1});
	g.headchannels = [a, b];
	// The drag's optimistic move, on screen.
	channels.append(b.createguildHTML(), a.createguildHTML());

	const restore = g.snapshotLayout();
	g.headchannels = [b, a];
	restore();

	expect(g.headchannels.map((c) => c.id)).toEqual(["a", "b"]);
	// Both rebuild paths append one wrapper div: the row order is what it must restore.
	expect(channels.textContent).toBe("ab");
	// The refusal must not cost the user their open search.
	expect(g.localuser.searching).toBe(true);
	expect(side.classList.contains("searchDiv")).toBe(true);
	expect(searchBox.textContent).toBe("stale");
});

it("a drop whose row lacks its wrappers changes nothing", () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const cat1 = chan(g, "cat1", {type: 4, position: 0});
	const cat2 = chan(g, "cat2", {type: 4, position: 1});
	const kid = chan(g, "kid", {position: 0, parent: cat1});
	cat1.children = [kid];
	g.headchannels = [cat1, cat2];
	g.channels = [cat1, cat2, kid];

	// Deliberately detached: the drop handler's wrapper lookups come up empty.
	const div = document.createElement("div");
	kid.coatDropDiv(div);
	Channel.dragged = [cat2, document.createElement("div")];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	expect(sent).toEqual([]);
	expect(g.headchannels.map((c) => c.id)).toEqual(["cat1", "cat2"]);
});

it("a category dropped onto a child row lands beside the child's category and PATCHes", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const cat1 = chan(g, "cat1", {type: 4, position: 0});
	const cat2 = chan(g, "cat2", {type: 4, position: 1});
	const kid = chan(g, "kid", {position: 0, parent: cat1});
	cat1.children = [kid];
	g.headchannels = [cat1, cat2];
	g.channels = [cat1, cat2, kid];

	const wrap = document.createElement("div");
	const outer = document.createElement("div");
	const div = document.createElement("div");
	wrap.append(div);
	outer.append(wrap);
	document.body.append(outer);
	kid.coatDropDiv(div);
	const ghost = document.createElement("div");
	Channel.dragged = [cat2, ghost];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	await vi.waitFor(() => expect(sent).toHaveLength(1));
	expect(g.headchannels.map((c) => c.id)).toEqual(["cat2", "cat1"]);
	// The dragged row now sits just before the child's category block.
	expect(ghost.parentElement).toBe(document.body);
	const bodyKids = [...document.body.children];
	expect(bodyKids.indexOf(ghost)).toBeLessThan(bodyKids.indexOf(outer));
});

it("a channel dropped onto a sibling lands before it and PATCHes", async () => {
	const sent = captureRequests(CHANNELS, () => new Response(null, {status: 204}));
	const g = guild();
	const a = chan(g, "a", {position: 0});
	const b = chan(g, "b", {position: 1});
	const c = chan(g, "c", {position: 2});
	g.headchannels = [a, b, c];
	g.channels = [a, b, c];

	const wrap = document.createElement("div");
	const div = document.createElement("div");
	wrap.append(div);
	document.body.append(wrap);
	b.coatDropDiv(div);
	const ghost = document.createElement("div");
	Channel.dragged = [c, ghost];
	div.dispatchEvent(dropTopHalf());
	Channel.dragged = [];

	await vi.waitFor(() => expect(sent).toHaveLength(1));
	expect(g.headchannels.map((ch) => ch.id)).toEqual(["a", "c", "b"]);
	// The dragged row is inserted before the row it was dropped on.
	expect(ghost.parentElement).toBe(wrap);
	expect([...wrap.children].indexOf(ghost)).toBeLessThan([...wrap.children].indexOf(div));
});

it("a refused PATCH after a sibling drop restores the order and keeps the search panel", async () => {
	captureRequests(
		CHANNELS,
		() => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);
	const g = guild();
	g.localuser.searching = true;
	const side = document.createElement("div");
	side.id = "sideContainDiv";
	side.classList.add("searchDiv");
	const channels = document.createElement("div");
	channels.id = "channels";
	document.body.append(side, channels);

	const a = chan(g, "a", {position: 0});
	const b = chan(g, "b", {position: 1});
	const c = chan(g, "c", {position: 2});
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

	// The optimistic move, then the refusal puts it back.
	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
	expect(g.headchannels.map((ch) => ch.id)).toEqual(["a", "b", "c"]);
	expect(channels.textContent).toBe("abc");
	// The restore must not cost the user their open search.
	expect(g.localuser.searching).toBe(true);
	expect(side.classList.contains("searchDiv")).toBe(true);
});
