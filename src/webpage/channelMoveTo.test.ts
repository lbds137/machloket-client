import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://moveto.test/api/v9";

type C = InstanceType<typeof Channel>;
type G = {
	info: {api: string};
	headchannels: C[];
	channels: C[];
	localuser: {lookingguild?: unknown; user: {id: string}};
	snapshotLayout: () => () => void;
	calculateReorder: (movedId?: string, restore?: () => void) => Promise<void>;
	buildChannelList?: () => HTMLElement;
};

/** A bare channel wired into the model by hand: parent/children/headchannels are plain arrays.
 * `hasPermission` defaults to false — the Move-to gate is the real one. */
function chan(id: string, type: number, parent: C | null, g: G): C {
	return Object.assign(Object.create(Channel.prototype), {
		id,
		name: id,
		type,
		parent,
		parent_id: parent?.id ?? null,
		move_id: undefined,
		position: 0,
		children: [],
		owner: g,
		hasPermission: () => false,
		isThread: () => false,
	}) as C;
}

/** A guild stub: the real snapshotLayout/calculateReorder are REPLACED with spies — their
 * behavior is pinned by the drag/refusal suites; here they only record the call order. */
function guild(): G {
	return {
		info: {api: API},
		headchannels: [],
		channels: [],
		localuser: {lookingguild: undefined, user: {id: "me-1"}},
		snapshotLayout: vi.fn(() => () => undefined),
		calculateReorder: vi.fn(async () => undefined),
	} as unknown as G;
}

function wire(g: G, channel: C): C {
	if (channel.parent) (channel.parent as C).children.push(channel);
	else g.headchannels.push(channel);
	g.channels.push(channel);
	return channel;
}

/** Renders the registered channel menu rows for a stubbed channel and returns their labels. */
function menuLabels(channel: C): string[] {
	const menu = document.createElement("div");
	for (const part of Channel.contextmenu.buttons) {
		part.makeContextHTML(channel, undefined, menu, [], new WeakSet());
	}
	return Array.from(menu.querySelectorAll("button")).map((b) => b.textContent ?? "");
}

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());
});

describe("the channel menu's Move to… row", () => {
	it("shows on a channel, not on a category, after the notifications row", () => {
		const g = guild();
		const cat = wire(g, chan("cat1", 4, null, g));
		const c = wire(g, chan("c1", 0, cat, g));
		c.hasPermission = () => true; // a channel manager

		const labels = menuLabels(c);
		// Positive control: the menu itself built, so an empty render can't pass the row pins.
		expect(labels).toContain(I18n.channel.markRead());
		expect(labels).toContain(I18n.channel.moveTo());
		expect(labels.indexOf(I18n.channel.moveTo())).toBeGreaterThan(
			labels.indexOf(I18n.guild.notifications()),
		);

		expect(menuLabels(cat), "categories reorder by drag").not.toContain(I18n.channel.moveTo());
	});

	it("hides from a member without MANAGE_CHANNELS and from threads", () => {
		const g = guild();
		const cat = wire(g, chan("cat1", 4, null, g));
		const member = wire(g, chan("c1", 0, cat, g)); // hasPermission: false by default
		const thread = wire(g, chan("t1", 11, cat, g));
		// A manager-thread: without it the permission clause shadows the thread pin.
		thread.hasPermission = () => true;
		thread.isThread = () => true;

		expect(menuLabels(member), "no MANAGE_CHANNELS").not.toContain(I18n.channel.moveTo());
		expect(menuLabels(thread), "threads aren't movable this way").not.toContain(
			I18n.channel.moveTo(),
		);
	});

	it("hides on a top-level channel in a guild with no categories — nothing to offer", () => {
		const g = guild();
		const top = wire(g, chan("top", 0, null, g));
		top.hasPermission = () => true; // even a manager: no categories to move to

		expect(menuLabels(top)).not.toContain(I18n.channel.moveTo());
	});

	it("picking a destination moves the channel and PATCHes through calculateReorder", () => {
		const g = guild();
		const cat1 = wire(g, chan("cat1", 4, null, g));
		const cat2 = wire(g, chan("cat2", 4, null, g));
		const c = wire(g, chan("c1", 0, cat1, g));
		// The success redraw swaps #channels from the model, like snapshotLayout's restore.
		g.localuser.lookingguild = g;
		g.buildChannelList = vi.fn(() => Object.assign(document.createElement("div"), {className: "rebuilt"}));
		const holder = document.createElement("div");
		holder.id = "channels";
		document.body.append(holder);

		const selects = vi.spyOn(Options.prototype, "addSelect");
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");
		c.moveToMenu();

		// The options are the categories in order, then No category; the current parent starts picked.
		const labels = selects.mock.calls[0][2] as string[];
		expect(labels).toEqual(["cat1", "cat2", I18n.channel.noCategory()]);
		const select = selects.mock.results[0].value as {onchange: (i: number) => void};
		select.onchange(1);
		(buttons.mock.calls[0][2] as () => void)();

		expect(c.parent).toBe(cat2);
		expect(c.move_id).toBe("cat2");
		expect(cat2.children).toContain(c);
		expect(cat1.children).not.toContain(c);
		// The snapshot is taken before the model moves, so a refusal puts it back.
		const snapshot = g.snapshotLayout as ReturnType<typeof vi.fn>;
		const reorder = g.calculateReorder as ReturnType<typeof vi.fn>;
		expect(snapshot.mock.invocationCallOrder[0]).toBeLessThan(reorder.mock.invocationCallOrder[0]);
		expect(reorder).toHaveBeenCalledWith("c1", expect.any(Function));
		expect(g.buildChannelList).toHaveBeenCalled();
		expect(holder.querySelector(".rebuilt"), "the list is redrawn at once").not.toBeNull();
		holder.remove();
		delete g.localuser.lookingguild;
	});

	it("a same-place pick changes nothing and sends nothing", () => {
		const g = guild();
		const cat1 = wire(g, chan("cat1", 4, null, g));
		const c = wire(g, chan("c1", 0, cat1, g));

		const selects = vi.spyOn(Options.prototype, "addSelect");
		const buttons = vi.spyOn(Options.prototype, "addButtonInput");
		c.moveToMenu();
		const select = selects.mock.results[0].value as {onchange: (i: number) => void};
		select.onchange(0); // its own category
		(buttons.mock.calls[0][2] as () => void)();

		expect(c.parent).toBe(cat1);
		expect(c.move_id).toBeUndefined();
		expect(g.calculateReorder).not.toHaveBeenCalled();
		// A no-op submit must not bump layoutSeq: that would disarm an in-flight drag's restore.
		expect(g.snapshotLayout).not.toHaveBeenCalled();
	});
});

describe("Channel.moveInto", () => {
	it("moves a channel to the end of a category, out of its old one", () => {
		const g = guild();
		const cat1 = wire(g, chan("cat1", 4, null, g));
		const cat2 = wire(g, chan("cat2", 4, null, g));
		const a = wire(g, chan("a", 0, cat1, g));
		const b = wire(g, chan("b", 0, cat2, g));

		expect(a.moveInto(cat2)).toBe(true);
		expect(a.parent).toBe(cat2);
		expect(a.move_id).toBe("cat2");
		expect(cat2.children).toEqual([b, a]);
		expect(cat1.children).not.toContain(a);
	});

	it("moves a top-level channel into a category, out of headchannels", () => {
		const g = guild();
		const cat = wire(g, chan("cat", 4, null, g));
		const a = wire(g, chan("a", 0, null, g));

		expect(a.moveInto(cat)).toBe(true);
		expect(g.headchannels).not.toContain(a);
		expect(cat.children).toEqual([a]);
		expect(a.parent).toBe(cat);
	});

	it("moves a categorised channel to the top level, above the categories", () => {
		const g = guild();
		const cat = wire(g, chan("cat", 4, null, g));
		const a = wire(g, chan("a", 0, cat, g));
		const top = wire(g, chan("top", 0, null, g));

		expect(a.moveInto(null)).toBe(true);
		expect(a.parent).toBeNull();
		expect(a.move_id).toBeUndefined();
		// Discord renders uncategorised channels above the categories.
		expect(g.headchannels).toEqual([a, cat, top]);
		expect(cat.children).not.toContain(a);
	});

	it("a same-place move returns false and changes nothing, category or top level", () => {
		const g = guild();
		const cat = wire(g, chan("cat", 4, null, g));
		const a = wire(g, chan("a", 0, cat, g));
		const top = wire(g, chan("top", 0, null, g));

		expect(a.moveInto(cat)).toBe(false);
		expect(top.moveInto(null)).toBe(false);
		expect(cat.children).toEqual([a]);
		expect(a.move_id).toBeUndefined();
		expect(g.headchannels).toEqual([cat, top]);
	});
});
