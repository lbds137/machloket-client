import {expect, it, onTestFinished, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Message} = await import("./message");
const {InfiniteScroller} = await import("./infiniteScroller");
const {messageIn} = await import("./test/interactionFixture");

const css = await (await fetch(new URL("./public/style.css", import.meta.url))).text();
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

const BODY = 50;
const VIEW = 300;
const GROUP = ["20", "21", "22", "23", "24"];
const authorOf = (id: string, username: string, relationshipType?: number) => ({
	id,
	username,
	name: username,
	relationshipType,
	// Header-render stubs: the real User methods would fetch avatars/members.
	buildpfp: () => {
		const el = document.createElement("div");
		el.style.cssText = "height:40px; width:40px;";
		return el;
	},
	bind: () => {},
	subName: () => {},
	getCustomBadges: async () => [],
	members: new Map(),
});

function messageAt(
	channel: unknown,
	id: string,
	author: {id: string; username: string; relationshipType?: number},
): InstanceType<typeof Message> {
	return Object.assign(Object.create(Message.prototype), {
		id,
		type: 0,
		flags: 0,
		author,
		owner: channel,
		headers: {},
		timestamp: new Date(2026, 9, 12, 11, 0).toISOString(),
		content: {
			makeHTML: () => {
				const d = document.createElement("div");
				d.style.height = BODY + "px";
				d.textContent = "body " + id;
				return d;
			},
			rawString: "body " + id,
			textContent: "body " + id,
			onUpdate: () => {},
		},
		reactions: [],
		embeds: [],
		attachments: [],
		stickers: [],
		edited_timestamp: null,
	}) as unknown as InstanceType<typeof Message>;
}

async function buildScroller(
	ids: string[],
	getIDFromOffset?: (id: string, offset: number) => Promise<string | undefined>,
	idToPrev = new Map<string, string>(),
	idToNext = new Map<string, string>(),
) {
	const {channel} = messageIn("guild-1");
	Object.assign(channel.owner as object, {localuser: {resolvemember: async () => undefined}});
	(channel.localuser as {user: unknown}).user = {id: "me"};
	const msgs = new Map<string, InstanceType<typeof Message>>();
	const blockerAuthor = authorOf("blocker", "blocker", 2);
	for (const [i, id] of ids.entries()) {
		const blocked = GROUP.includes(id);
		msgs.set(id, messageAt(channel, id, blocked ? blockerAuthor : authorOf("u" + id, "user" + id)));
		if (i > 0) idToPrev.set(id, ids[i - 1]);
		if (i < ids.length - 1) idToNext.set(id, ids[i + 1]);
	}

	const root = document.createElement("div");
	root.style.cssText = `height:${VIEW}px; overflow-y:auto;`;
	document.body.append(root);
	onTestFinished(() => root.remove());

	const infinite = new InfiniteScroller(
		getIDFromOffset ?? (async (id, offset) => (offset === 1 ? idToPrev.get(id) : idToNext.get(id))),
		(id: string): HTMLElement => {
			let m = msgs.get(id);
			if (!m) {
				const blocked = GROUP.includes(id);
				m = messageAt(channel, id, blocked ? blockerAuthor : authorOf("u" + id, "user" + id));
				msgs.set(id, m);
			}
			m.div = document.createElement("div");
			return m.generateMessage() as HTMLElement;
		},
		async () => true,
		() => {},
	);
	Object.assign(channel as object, {messages: msgs, idToPrev, idToNext, infinite});
	// The virtual cursor sits at (0,0): scrolling moves messages under it, firing the hover
	// handler. Nothing it gates on is under test, so every permission reads as denied.
	Object.assign(channel as object, {hasPermission: () => false});
	infinite.div = root;
	await infinite.getDiv("30", false);

	// IntersectionObserver delivery is async: the per-element ResizeObserver must be
	// observing the visible messages before any operation is measured.
	await vi.waitFor(() => {
		expect(infinite.getVisibleIds().length).toBeGreaterThan(2);
	});
	return {channel, msgs, infinite, root, idToPrev, idToNext};
}

const settle = async () => {
	await new Promise((r) => setTimeout(r, 200));
};

const topOf = (msgs: Map<string, InstanceType<typeof Message>>, id: string) =>
	msgs.get(id)!.div!.getBoundingClientRect().top;

/** Scroll so the collapsed group's bar sits fully above the scroller's top edge. */
function placeGroupAboveFold(root: HTMLDivElement, msgs: Map<string, InstanceType<typeof Message>>) {
	const bar = msgs.get("20")!.div!;
	root.scrollTop +=
		bar.getBoundingClientRect().top - root.getBoundingClientRect().top + bar.offsetHeight + 10;
}

const collapsedBarSpan = (msgs: Map<string, InstanceType<typeof Message>>) =>
	msgs.get("20")!.div!.querySelector(".blocked span") as HTMLSpanElement;

const expandedHideSpan = (msgs: Map<string, InstanceType<typeof Message>>) =>
	msgs.get("20")!.div!.querySelector("span.blocked") as HTMLSpanElement;

it("expanding a blocked bar above the viewport engages the scroll compensation", async () => {
	// Measured: with the bar scrolled off the top, Chromium's scroll
	// anchoring absorbs most — not all — of the expansion on this layout (~100px of ~280px
	// growth reached the view). Pinned: the compensation engages (the scroll moves up) and
	// the visible content never rides the full growth, which a manual double-compensation
	// fighting the anchor would produce.
	const full = Array.from({length: 40}, (_, i) => String(i + 1));
	const idToPrev = new Map<string, string>();
	const idToNext = new Map<string, string>();
	const {msgs, root} = await buildScroller(
		full,
		async (id, offset) => (offset === 1 ? idToPrev.get(id) : idToNext.get(id)),
		idToPrev,
		idToNext,
	);

	placeGroupAboveFold(root, msgs);
	await settle();
	const before = topOf(msgs, "27");
	const scrollTopBefore = root.scrollTop;
	const heightBefore = root.scrollHeight;

	collapsedBarSpan(msgs).click();
	await settle();
	const grew = root.scrollHeight - heightBefore;
	expect(grew).toBeGreaterThan(0);
	expect(root.scrollTop).toBeGreaterThan(scrollTopBefore);
	expect(Math.abs(topOf(msgs, "27") - before)).toBeLessThan(grew);

	// The collapse unwinds the compensation: the scroll returns toward where it was.
	const scrollTopExpanded = root.scrollTop;
	expandedHideSpan(msgs).click();
	await settle();
	expect(root.scrollTop).toBeLessThan(scrollTopExpanded);
});

it("deleting a message next to a collapsed blocked group lets the flow slide", async () => {
	// Measured: the messages below a deleted visible message slide up by
	// its height — the natural flow Discord shows. This pins the absence of a compensator
	// fighting it.
	const full = Array.from({length: 40}, (_, i) => String(i + 1));
	const idToPrev = new Map<string, string>();
	const idToNext = new Map<string, string>();
	const {msgs, root} = await buildScroller(
		full,
		async (id, offset) => (offset === 1 ? idToPrev.get(id) : idToNext.get(id)),
		idToPrev,
		idToNext,
	);

	placeGroupAboveFold(root, msgs);
	await settle();
	const before = topOf(msgs, "27");
	const h25 = msgs.get("25")!.div!.offsetHeight;
	msgs.get("25")!.deleteEvent();
	await settle();
	const slide = before - topOf(msgs, "27");
	expect(slide).toBeGreaterThan(h25 - 12);
	expect(slide).toBeLessThanOrEqual(h25 + 12);
});

it("history loading above a collapsed blocked group while scrolling up holds the view", async () => {
	let olderLoaded = false;
	const idToPrev = new Map<string, string>();
	const idToNext = new Map<string, string>();
	const {channel, msgs, infinite, root} = await buildScroller(
		Array.from({length: 21}, (_, i) => String(i + 20)),
		async (id, offset) => {
			if (offset !== 1) return idToNext.get(id);
			if (idToPrev.has(id)) return idToPrev.get(id);
			if (id === "20") {
				// Mirrors channel.ts's stub: a page that hasn't loaded yet fails the walk
				// (the failure is not linked, so a later fill asks again).
				if (!olderLoaded) throw new Error("history page failed");
				return "19";
			}
			return undefined;
		},
		idToPrev,
		idToNext,
	);

	// The initial fill appends in batches: wait for the whole page before measuring, then
	// place message 30 in the view explicitly (the scroller's own centering never scrolls
	// here — the list grows downward from the focused message).
	await vi.waitFor(() => {
		expect(root.children[0]!.children.length).toBe(21);
	});
	await settle();
	const thirty = msgs.get("30")!.div!;
	root.scrollTop =
		thirty.getBoundingClientRect().top - root.getBoundingClientRect().top + thirty.offsetHeight / 2 - VIEW / 2;
	await settle();
	root.scrollTop -= 400;
	// The user's scroll moved the window; the position it lands at is what must hold while
	// the page above loads.
	const afterScroll = topOf(msgs, "27");
	olderLoaded = true;
	for (let i = 10; i < 20; i++) {
		msgs.set(String(i), messageAt(channel, String(i), authorOf("u" + i, "user" + i)));
		if (i > 10) idToPrev.set(String(i), String(i - 1));
		idToNext.set(String(i), String(i + 1));
	}

	// The fill the IntersectionObserver refocus runs mid-scroll: the walk hits the loaded
	// range's top, the pending page arrives, and everything prepends above the group.
	await (infinite as unknown as {fillIn: (refill?: boolean) => Promise<void>}).fillIn(true);
	await vi.waitFor(
		() => {
			expect(root.children[0]!.children.length).toBe(31);
		},
		{timeout: 4000},
	);
	await settle();
	expect(Math.abs(topOf(msgs, "27") - afterScroll)).toBeLessThanOrEqual(1);
});
