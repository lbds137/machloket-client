import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {installDrawerSwipe} = await import("./drawerSwipe");
const {installMembersView, consumeMembersPop} = await import("./membersView");
const {installSearchView, consumeSearchPop, closeSearchOnNavigation, SEARCH_RESULT_CLASS} =
	await import("./searchView");

// The entry's popstate wiring, once for the whole file: the members guard runs before the
// search guard (index.ts chains them), and what navigation would receive lands in navStates.
let navStates: unknown[] = [];
window.addEventListener("popstate", (e) => {
	if (!consumeMembersPop() && !consumeSearchPop()) navStates.push(e.state);
});

let page: HTMLElement;
let searchMeta: HTMLElement;
let searchX: HTMLElement;
let searchBox: HTMLElement;
let panel: HTMLElement;

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
			<span id="channelTitle"><span id="channelname">#general</span></span>
			<div class="searchMeta">
				<div contenteditable="true" class="searchBox" id="searchBox"></div>
				<span id="searchX" class="svgicon svg-search"></span>
			</div>
			<div id="pinnedMDiv"><span class="svgicon svg-pin"></span></div>
			<div id="inboxMDiv"><span class="svgicon svg-inbox"></span></div>
		</div>
		<div id="sideContainDiv" style="width: 360px; height: 560px">
			<div id="sideDiv"><div class="topMessage ${SEARCH_RESULT_CLASS}"><span class="result">a search result</span></div></div>
		</div>`;
	document.body.append(page);
	navStates = [];
	// Earlier tests in this file leave their markers current in the shared history stack;
	// seat each test on a known non-marker entry so marker assertions are meaningful.
	history.pushState({testBase: true}, "", location.href);
	searchMeta = page.querySelector(".searchMeta")!;
	searchX = page.querySelector("#searchX")!;
	searchBox = page.querySelector("#searchBox")!;
	panel = page.querySelector("#sideContainDiv")!;
});

const searchShown = () => page.classList.contains("mobileSearchOpen");
const boxHome = () => searchBox.parentElement === searchMeta;
const maintoggle = () => page.querySelector<HTMLInputElement>("#maintoggle")!;

/** Installs the view with fresh deps. The header-expanding stand-in for index.ts's own
 * magnifier handler is registered FIRST, at the target: at-target listeners run in
 * registration order regardless of capture, so it proves the intercept beats it from the
 * parent's capture phase, where phase order does apply. The mSearch mock mirrors the real
 * one's empty-query branch (it strips the panel classes) — a bare vi.fn() let a teardown
 * that ordered against the real mSearch wrong pass (the review's round-1 blocker). */
function install() {
	const onQueryClear = vi.fn();
	const mSearch = vi.fn((query: string) => {
		if (query === "") {
			panel.classList.remove("searchDiv");
			panel.classList.remove("hideSearchDiv");
			// The debounced member-list rebuild strips them again ~100ms later (localuser's
			// listque setTimeout) — the async strip that beat the round-1 reorder fix.
			setTimeout(() => panel.classList.remove("hideSearchDiv"), 100);
		}
	});
	const headerHandler = vi.fn(() => {
		searchMeta.classList.add("searching");
	});
	searchX.addEventListener("click", headerHandler);
	installSearchView(page, {onQueryClear, mSearch});
	return {onQueryClear, mSearch, headerHandler};
}

/** Installs all three gesture systems the way index.ts's mobile block does (drawer swipe,
 * members view, search view), for the swipe and mutual-exclusion tests. */
function installAll() {
	installDrawerSwipe(page, {
		isOpen: () => !maintoggle().checked,
		openChat: () => {
			maintoggle().checked = true;
		},
		closeChat: () => {
			maintoggle().checked = false;
		},
		panel: () => page.querySelector("#mainarea"),
		peekLeft: () => 280,
	});
	installMembersView(page);
	return install();
}

const at = (target: HTMLElement, x: number, y: number) =>
	new Touch({identifier: 1, target, pageX: x, pageY: y, clientX: x, clientY: y});
function fire(target: HTMLElement, type: string, touches: Touch[], changed: Touch[]) {
	target.dispatchEvent(
		new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
	);
}
function swipe(target: HTMLElement, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
	fire(target, "touchstart", [at(target, x0, y0)], [at(target, x0, y0)]);
	for (let step = 1; step <= 4; step++) {
		const x = x0 + ((x1 - x0) * step) / 4;
		const y = y0 + ((y1 - y0) * step) / 4;
		fire(target, "touchmove", [at(target, x, y)], [at(target, x, y)]);
		getComputedStyle(panel).transform;
	}
	fire(target, "touchend", [], [at(target, x1, y1)]);
}
const glide = () => new Promise((res) => setTimeout(res, 400));
/** teardown drops the class only after the slide-out's 300ms window. */
const afterCloseWindow = () => new Promise((res) => setTimeout(res, 360));
/** Pops settle asynchronously, and a skip issues its own back() mid-listener. */
const settle = () => new Promise((res) => setTimeout(res, 120));

const popArmed = () => new Promise((res) => window.addEventListener("popstate", res, {once: true}));

/** Opens the view (a magnifier tap) and arms the pop a UI close will trigger. */
function openAndView(deps?: ReturnType<typeof install>) {
	const d = deps ?? install();
	searchX.click();
	expect(searchShown()).toBe(true);
	return {pop: popArmed(), ...d};
}

describe("opening the search view", () => {
	it("the header magnifier opens it, with a history entry behind it", () => {
		const {headerHandler} = install();

		searchX.click();

		expect(searchShown()).toBe(true);
		expect((history.state as {machloketSearchView?: boolean}).machloketSearchView).toBe(true);
		// The entry's own magnifier handler (expand the header input) must not have run.
		expect(headerHandler).not.toHaveBeenCalled();
		expect(searchMeta.classList.contains("searching")).toBe(false);
	});

	it("the real input moves into the view's row, focused", () => {
		install();

		searchX.click();

		const row = panel.querySelector(".searchViewRow")!;
		expect(row).toBeTruthy();
		expect(searchBox.parentElement).toBe(row);
		expect(document.activeElement).toBe(searchBox);
	});

	it("opening it closes the members view (they share the panel)", () => {
		installAll();

		(page.querySelector("#channelTitle") as HTMLElement)!.click();
		expect(page.classList.contains("mobileMembersOpen")).toBe(true);

		searchX.click();

		expect(page.classList.contains("mobileMembersOpen")).toBe(false);
		expect(searchShown()).toBe(true);
	});

	it("opening it over the members view leaves its own marker current; one back closes it", async () => {
		// The previous test's close leaves a traversal queued; let it land, then re-seat.
		await settle();
		history.pushState({testBase: true}, "", location.href);
		installAll();
		(page.querySelector("#channelTitle") as HTMLElement)!.click();
		await settle();

		searchX.click();
		await settle();

		// The members close must not traverse history under the search push: the marker
		// the view's back relies on is the current entry.
		expect((history.state as {machloketSearchView?: boolean} | null)?.machloketSearchView).toBe(
			true,
		);
		const pop = popArmed();
		history.back();
		await pop;
		await settle();
		expect(boxHome()).toBe(true);
		expect(navStates).toEqual([]);
		expect((history.state as {testBase?: boolean} | null)?.testBase).toBe(true);
	});
});

describe("closing the search view", () => {
	it("the row's back arrow closes it, consumes its entry, and restores the input home", async () => {
		const {pop, onQueryClear, mSearch} = openAndView();

		(panel.querySelector(".searchBack") as HTMLElement)!.click();

		// The teardown is immediate; the class rides the slide-out and drops after it.
		expect(boxHome()).toBe(true);
		expect(panel.querySelector(".searchViewRow")).toBeNull();
		// The empty-query teardown ran (sidebar rest state), and the query was cleared.
		expect(mSearch).toHaveBeenCalledWith("");
		expect(onQueryClear).toHaveBeenCalled();
		await pop;
		await afterCloseWindow();
		expect(searchShown()).toBe(false);
		expect((history.state as {machloketSearchView?: boolean} | null)?.machloketSearchView)
			.not.toBe(true);
	});

	it("Android back closes an open search view", async () => {
		openAndView();

		const pop = popArmed();
		history.back();
		await pop;

		// DOM teardown is immediate; the class drops after the slide-out's window.
		expect(boxHome()).toBe(true);
		await afterCloseWindow();
		expect(searchShown()).toBe(false);
	});

	it("the slide-out's class survives the search flow's own strips — sync and debounced", async () => {
		const {pop} = openAndView();

		(panel.querySelector(".searchBack") as HTMLElement)!.click();

		// The close rides searchViewClosing, which no search-flow path removes; hideSearchDiv
		// gets stripped twice (mSearch("")'s empty branch synchronously, the member-list
		// rebuild ~100ms later) and riding the close on it froze the panel over the header
		// for the whole window (the review's blocker, both rounds).
		expect(panel.classList.contains("searchViewClosing")).toBe(true);
		await new Promise((res) => setTimeout(res, 150));
		expect(panel.classList.contains("searchViewClosing")).toBe(true);
		await pop;
		await afterCloseWindow();
		expect(panel.classList.contains("searchViewClosing")).toBe(false);
	});

	it("the class drops only after the slide-out's window — and a reopen inside it cancels the drop", async () => {
		const {mSearch} = openAndView();

		(panel.querySelector(".searchBack") as HTMLElement)!.click();
		expect(searchShown()).toBe(true); // still mid-slide

		searchX.click(); // reopen before the window elapses
		expect(searchShown()).toBe(true);
		await afterCloseWindow();
		expect(searchShown()).toBe(true); // the cancelled timer did not close it
		expect(mSearch).toHaveBeenCalledTimes(1); // the close's teardown, nothing since
	});
});

describe("the clear button", () => {
	it("empties the query without dismissing the view or running a search", () => {
		const {onQueryClear, mSearch} = openAndView();

		(panel.querySelector(".searchClear") as HTMLElement)!.click();

		expect(onQueryClear).toHaveBeenCalledTimes(1);
		expect(mSearch).not.toHaveBeenCalled();
		expect(searchShown()).toBe(true);
	});
});

describe("tapping a search result", () => {
	it("closes the view with no history operation — a same-channel jump pushes nothing", async () => {
		const {mSearch} = openAndView();

		(panel.querySelector(".result") as HTMLElement)!.click();

		expect(searchShown()).toBe(true); // mid-slide; the marker stays untouched
		expect((history.state as {machloketSearchView?: boolean}).machloketSearchView).toBe(true);
		expect(mSearch).toHaveBeenCalledWith("");
		expect(boxHome()).toBe(true);

		// The marker left on top is stale with the view closed: one Android back skips
		// past it and navigates once.
		const before = navStates.length;
		history.back();
		await settle();
		await settle();
		expect(navStates.length).toBe(before + 1);

		await afterCloseWindow();
		expect(searchShown()).toBe(false);
	});

	it("reopening over the stale marker reuses it — no adjacent second marker", async () => {
		const {pop} = openAndView();

		(panel.querySelector(".result") as HTMLElement)!.click(); // stale marker stays current
		expect((history.state as {machloketSearchView?: boolean}).machloketSearchView).toBe(true);

		searchX.click(); // reopen: reuses the stale marker, pushes nothing
		expect(searchShown()).toBe(true);

		(panel.querySelector(".searchBack") as HTMLElement)!.click();
		await pop;
		// One marker, one close: the entry below (the test base, a channel state in the
		// app) is current again — not another marker (round-1 blocker: the second marker
		// reached goToState on back and died there).
		expect((history.state as {machloketSearchView?: boolean} | null)?.machloketSearchView)
			.not.toBe(true);
	});

	it("two adjacent markers anyway (the backstop's worst case) are skipped in one back press", async () => {
		install();
		// Hand-stack the adjacency the open path now prevents — the backstop still owes
		// correct behavior if one ever slips through.
		history.pushState({machloketSearchView: true}, "", location.href);
		history.pushState({machloketSearchView: true}, "", location.href);

		history.back();
		await settle();
		await settle();

		// Both markers skipped within one press; navigation never saw a marker state.
		expect(navStates).toHaveLength(1);
		expect((navStates[0] as {machloketSearchView?: boolean}).machloketSearchView).not.toBe(true);
	});

	it("a reuse-open over the just-closed view's pending back() leaves a clean stack", async () => {
		install();

		searchX.click(); // push the marker
		(panel.querySelector(".searchBack") as HTMLElement)!.click(); // close: back() queued
		searchX.click(); // reopen in the same tick: traversal pending, marker still current

		expect(searchShown()).toBe(true);
		// The queued traversal lands on the base entry; the close's suppressPop eats it.
		await settle();
		expect((history.state as {machloketSearchView?: boolean} | null)?.machloketSearchView)
			.toBeUndefined();

		// The view is open with NO marker anywhere: Android back must close it (the guard's
		// open-but-not-ours branch) and navigation must stand down. The class drops 300ms
		// after teardown — wait the window out (probe-verified interleaving, review round 2).
		history.back();
		await settle();
		await afterCloseWindow();

		expect(searchShown()).toBe(false);
		expect(navStates).toHaveLength(0);
	});
});

describe("navigation closes the view (Discord's app behavior)", () => {
	it("pushes the channel entry, then closes the view over it — and the entry stays current", async () => {
		openAndView();

		// The app's exact order (channel.ts): the push first, the close after (the 9c
		// round-4 blocker, pinned here too).
		history.pushState({nav: "channel-b"}, "", location.href);
		closeSearchOnNavigation();

		expect((history.state as {nav?: string}).nav).toBe("channel-b");

		// One Android back from the channel: the buried marker is skipped, one navigation.
		history.back();
		await settle();
		await settle();
		expect(navStates).toHaveLength(1);
	});

	it("a navigation with the view closed changes nothing", () => {
		install();

		closeSearchOnNavigation();

		expect(searchShown()).toBe(false);
	});
});

describe("the closing swipe", () => {
	it("a right swipe with the view open closes it — and only it", async () => {
		const pop = popArmed();
		installAll();
		searchX.click();
		expect(searchShown()).toBe(true);

		swipe(panel, [40, 300], [180, 304]);
		await pop;
		await glide();

		expect(searchShown()).toBe(false);
		// The chat behind never went to the drawer (maintoggle checked = chat open).
		expect(maintoggle().checked).toBe(true);
		expect(panel.style.transform).toBe("");
	});

	it("with the view closed, a right swipe still goes to the drawer", async () => {
		installAll();

		swipe(panel, [40, 300], [180, 304]);
		await glide();

		expect(maintoggle().checked).toBe(false);
	});

	it("the members view keeps its own swipe with the search view installed", async () => {
		installAll();
		(page.querySelector("#channelTitle") as HTMLElement)!.click();
		expect(page.classList.contains("mobileMembersOpen")).toBe(true);

		swipe(panel, [40, 300], [180, 304]);
		await glide();

		expect(page.classList.contains("mobileMembersOpen")).toBe(false);
		expect(searchShown()).toBe(false);
	});
});
