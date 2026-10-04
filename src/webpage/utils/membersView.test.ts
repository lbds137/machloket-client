import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {installDrawerSwipe, drawerSwipeJustEnded} = await import("./drawerSwipe");
const {installMembersView, consumeMembersPop, closeMembersOnNavigation} = await import("./membersView");

// The entry's popstate wiring, once for the whole file: the members guard runs before channel
// navigation would, and a UI close's swallowed pop actually clears its flag. What navigation
// would receive lands in navStates, mirroring index.ts's goToState call.
let navStates: unknown[] = [];
window.addEventListener("popstate", (e) => {
	if (!consumeMembersPop()) navStates.push(e.state);
});

let page: HTMLElement;
let channelTitle: HTMLElement;
let maintoggle: HTMLInputElement;
let maintoggleIcon: HTMLElement;
let membersPanel: HTMLElement;
let chatPanel: HTMLElement;

/** Where the chat rests beside the open drawer (the mobile CSS peek, 9d's target). */
const PEEK_LEFT = 280;

beforeEach(() => {
	document.querySelectorAll(".testPage").forEach((el) => el.remove());
	page = document.createElement("div");
	page.className = "testPage";
	page.id = "page";
	page.innerHTML = `
		<input type="checkbox" id="maintoggle" checked />
		<input type="checkbox" id="memberlisttoggle" />
		<div class="header">
			<label for="maintoggle" id="maintoggleicon"><span class="chev"></span></label>
			<span id="channelTitle"><span id="channelname">#general</span><span id="channelTopic">the topic</span></span>
			<label for="memberlisttoggle" id="memberlisttoggleicon"><span></span></label>
			<div id="pinnedMDiv"></div>
			<div id="inboxMDiv"></div>
		</div>
		<div id="mainarea" style="position: absolute; top: 40px; left: 0; width: 360px; height: 560px">
			<div class="message">hello</div>
		</div>
		<div id="sideContainDiv" style="width: 360px; height: 560px"><div id="sideDiv"><div class="memberrow"></div></div></div>`;
	document.body.append(page);
	navStates = [];
	channelTitle = page.querySelector("#channelTitle")!;
	maintoggle = page.querySelector("#maintoggle")!;
	maintoggleIcon = page.querySelector("#maintoggleicon")!;
	membersPanel = page.querySelector("#sideContainDiv")!;
	chatPanel = page.querySelector("#mainarea")!;
});

const membersShown = () => page.classList.contains("mobileMembersOpen");

/** Installs both gesture systems the way index.ts's mobile block does: the drawer's swipe
 * first (its listeners run first for a touch landing mid-glide), then this view's. */
function install() {
	const closeChat = vi.fn(() => {
		maintoggle.checked = false;
		chatPanel.style.left = `${PEEK_LEFT}px`;
	});
	installDrawerSwipe(page, {
		isOpen: () => !maintoggle.checked,
		openChat: () => {
			maintoggle.checked = true;
			chatPanel.style.left = "0px";
		},
		closeChat,
		panel: () => chatPanel,
		peekLeft: () => PEEK_LEFT,
	});
	installMembersView(page);
	return {closeChat};
}

const at = (target: HTMLElement, x: number, y: number) =>
	new Touch({identifier: 1, target, pageX: x, pageY: y, clientX: x, clientY: y});
function fire(target: HTMLElement, type: string, touches: Touch[], changed: Touch[]) {
	target.dispatchEvent(
		new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
	);
}
/** One finger from (x0, y0) to (x1, y1): touchstart, four touchmoves, lift unless `hold`. */
function swipe(
	target: HTMLElement,
	[x0, y0]: [number, number],
	[x1, y1]: [number, number],
	{hold = false} = {},
) {
	fire(target, "touchstart", [at(target, x0, y0)], [at(target, x0, y0)]);
	for (let step = 1; step <= 4; step++) {
		const x = x0 + ((x1 - x0) * step) / 4;
		const y = y0 + ((y1 - y0) * step) / 4;
		fire(target, "touchmove", [at(target, x, y)], [at(target, x, y)]);
		getComputedStyle(membersPanel).transform;
	}
	if (!hold) fire(target, "touchend", [], [at(target, x1, y1)]);
}
const glide = () => new Promise((res) => setTimeout(res, 400));
const membersOffsetX = () => new DOMMatrix(getComputedStyle(membersPanel).transform).m41;

/** A popstate listener armed BEFORE the action that will trigger it (a pop can land inside a
 * glide, ahead of any listener armed after). */
const popArmed = () => new Promise((res) => window.addEventListener("popstate", res, {once: true}));

/** Opens the view and arms the pop its close will trigger. Synchronous on purpose: returning
 * the armed promise from an async helper would make awaiting the helper await the pop itself. */
function openAndView() {
	install();
	channelTitle.click();
	expect(membersShown()).toBe(true);
	return popArmed();
}

describe("opening the members view", () => {
	it("a tap on the channel name opens it, with a history entry behind it", async () => {
		const pop = openAndView();

		expect((history.state as {machloketMembersView?: boolean}).machloketMembersView).toBe(true);

		maintoggleIcon.click();
		await pop;
		expect(membersShown()).toBe(false);
	});
});

describe("closing the members view", () => {
	it("the header's left icon is its back arrow: closing leaves the chat open", async () => {
		const pop = openAndView();

		maintoggleIcon.click();

		expect(membersShown()).toBe(false);
		// The label must not have toggled the drawer open instead (the pre-9c complaint).
		expect(maintoggle.checked).toBe(true);
		await pop;
	});

	it("Android back closes an open members view", async () => {
		openAndView();

		const pop = popArmed();
		history.back();
		await pop;

		expect(membersShown()).toBe(false);
	});

	it("closing through the UI consumes its own history entry", async () => {
		openAndView();

		const pop = popArmed();
		maintoggleIcon.click();
		await pop;

		expect(membersShown()).toBe(false);
		expect((history.state as {machloketMembersView?: boolean} | null)?.machloketMembersView)
			.not.toBe(true);
	});

	it("the header's pins and inbox close it first, so they act on the chat", async () => {
		for (const id of ["pinnedMDiv", "inboxMDiv"]) {
			const pop = openAndView();
			(page.querySelector("#" + id) as HTMLElement).click();
			expect(membersShown()).toBe(false);
			await pop;
		}
	});
});

describe("the closing swipe", () => {
	it("a right swipe with members open closes them — and only them", async () => {
		const {closeChat} = install();
		const pop = openAndView();

		swipe(membersPanel, [40, 300], [180, 304]);
		await pop;
		await glide();

		expect(membersShown()).toBe(false);
		// The swipe closed the members view; the chat behind it never went to the drawer.
		expect(closeChat).not.toHaveBeenCalled();
		expect(maintoggle.checked).toBe(true);
		expect(membersPanel.style.transform).toBe("");
	});

	it("the members panel follows the finger while the swipe is under way", async () => {
		const pop = openAndView();

		swipe(membersPanel, [40, 300], [160, 304], {hold: true});

		// Four moves of +30 px each: the panel is 120 px into its closing travel.
		expect(membersOffsetX()).toBe(120);
		expect(membersPanel.style.transition).toBe("none");

		fire(membersPanel, "touchend", [], [at(membersPanel, 160, 304)]);
		await pop;
		await glide();
	});

	it("a left swipe on the open members list leaves it open", async () => {
		const pop = openAndView();

		swipe(membersPanel, [300, 300], [180, 302]);
		await glide();

		expect(membersShown()).toBe(true);
		expect(membersPanel.style.transform).toBe("");

		maintoggleIcon.click();
		await pop;
	});

	it("a short swipe springs the panel back and keeps the view open", async () => {
		const pop = openAndView();

		swipe(membersPanel, [40, 300], [70, 302]);
		await glide();

		expect(membersShown()).toBe(true);
		expect(membersPanel.style.transform).toBe("");

		maintoggleIcon.click();
		await pop;
	});

	it("a cancelled long drag springs back and keeps the view open", async () => {
		// A cancel (Android's edge back) isn't the user choosing to close.
		const pop = openAndView();

		swipe(membersPanel, [40, 300], [180, 304], {hold: true});
		fire(membersPanel, "touchcancel", [], [at(membersPanel, 180, 304)]);
		// No trailing click follows a cancel, so there's none to swallow: the next tap counts.
		expect(drawerSwipeJustEnded()).toBe(false);
		await glide();

		expect(membersShown()).toBe(true);
		expect(membersPanel.style.transform).toBe("");

		maintoggleIcon.click();
		await pop;
	});

	it("a second finger mid-drag springs the panel back", async () => {
		const pop = openAndView();

		swipe(membersPanel, [40, 300], [160, 304], {hold: true});
		const second = new Touch({identifier: 2, target: membersPanel, pageX: 200, pageY: 400});
		fire(membersPanel, "touchstart", [at(membersPanel, 160, 304), second], [second]);
		await glide();

		expect(membersShown()).toBe(true);
		expect(membersPanel.style.transform).toBe("");

		maintoggleIcon.click();
		await pop;
	});

	it("with members closed, a right swipe still goes to the drawer", async () => {
		const {closeChat} = install();

		swipe(chatPanel, [40, 300], [180, 304]);
		await glide();

		expect(closeChat).toHaveBeenCalledTimes(1);
	});
});

/** Pops settle asynchronously, and the skip issues its own back() mid-listener; a short
 * settle (not a late-armed listener) is what reliably observes the landed state. */
const settle = () => new Promise((res) => setTimeout(res, 120));

describe("the marker entry between channel entries", () => {
	it("one Android back, with navigation stacked above the marker, lands on the channel below", async () => {
		openAndView();
		// A pinned message or search result navigates while the view stays open: the channel
		// entry lands ABOVE this view's marker (the review's blocker).
		history.pushState({nav: "channel-b"}, "", location.href);

		history.back();
		await settle();
		await settle();

		expect(membersShown()).toBe(false);
		// One user back: the marker was skipped past and exactly one navigation ran.
		expect(navStates).toHaveLength(1);
	});

	it("a back that lands on a stale marker with the view closed still navigates", async () => {
		openAndView();
		history.pushState({nav: "channel-b"}, "", location.href);
		maintoggleIcon.click(); // UI close with the marker buried: no back() of its own
		expect(membersShown()).toBe(false);

		history.back(); // Android back: pops the navigation, lands on the stale marker
		await settle();
		await settle();

		expect(membersShown()).toBe(false);
		expect(navStates.length).toBeGreaterThanOrEqual(1);
	});
});

describe("what a tap on the title is not", () => {
	it("a tap on the topic keeps the members view closed (the topic has its own UI)", () => {
		install();

		(page.querySelector("#channelTopic") as HTMLElement)!.click();

		expect(membersShown()).toBe(false);
		expect((history.state as {machloketMembersView?: boolean} | null)?.machloketMembersView)
			.not.toBe(true);
	});

	it("an empty member panel (a DM's cleared list) still opens — the tap must not dead-lock", () => {
		// memberListUpdate clears #sideDiv for DMs and voice channels; refusing to open
		// there made both the title tap and the members icon permanently dead (the
		// phone-walk find). The view opens regardless; content is its own backlog item.
		install();
		page.querySelector("#sideDiv")!.innerHTML = "";

		channelTitle.click();

		expect(membersShown()).toBe(true);
	});
});

describe("navigation closes the view (the owner's call, Discord's app behavior)", () => {
	it("pushes the channel entry, then closes the view over it — and the entry stays current", async () => {
		openAndView();

		// The app's exact order (channel.ts): the push first, the close after. A close
		// BEFORE the push would let its history.back() traversal land past the entry the
		// push is about to add (the round-4 blocker).
		history.pushState({nav: "channel-b"}, "", location.href);
		closeMembersOnNavigation();

		expect(membersShown()).toBe(false);
		expect((history.state as {nav?: string}).nav).toBe("channel-b");

		// One Android back from the channel: the buried marker is skipped, one navigation.
		history.back();
		await settle();
		await settle();
		expect(navStates).toHaveLength(1);
	});

	it("a navigation with the view closed changes nothing", () => {
		install();

		closeMembersOnNavigation();

		expect(membersShown()).toBe(false);
	});
});
