// The mobile search is its own full-screen view, on Discord's app model (tracker 18b): the
// header magnifier opens it, and the view owns its whole surface — a back arrow and the input
// in a row of its own, results below — instead of an input squeezed over the channel header
// whose only dismissals were a toggle nobody found. The back arrow, Android back and a right
// swipe close it. The members view keeps its below-header slide-over (9c); the two share the
// side panel and this panel's swipe machinery, and only one is ever open — opening either
// closes the other.

import {handOffMembersView} from "./membersView.js";
import {installOverlaySwipe} from "./drawerSwipe.js";

/** What the view needs from its installer (index.ts): resetting the query touches the MarkDown
 * instance and the header's magnifier/✕ state, which live in the entry's closure. */
export type SearchViewDeps = {
	/** Empties the query and restores the header's magnifier state (no search runs). */
	onQueryClear(): void;
	/** The empty-query teardown: restores the sidebar's rest state (searching=false, member
	 * list rebuilt) exactly as the desktop ✕ does. */
	mSearch(query: string): void;
};

/** The class the search flow (localuser.mSearch) puts on each result it renders: the rows are
 * dupe builds (buildhtml(_, true)), which never get .messagediv, so the result-tap close keys
 * on this instead. */
export const SEARCH_RESULT_CLASS = "searchViewResult";

let installed = false;
let suppressPop = false;
/** A marker entry is being skipped: the pop landing below it is real navigation. */
let skipLanding = false;
/** #page; the class is the one writer of this view. */
let page: HTMLElement | null = null;
let deps: SearchViewDeps | null = null;
/** The slide-out's class drop, held until the transition has played (removing it sooner
 * teleports the panel mid-animation); cleared if the view reopens inside the window. */
let closeTimer: ReturnType<typeof setTimeout> | undefined;

/** The view's logical state. The #page class is ANIMATION state: it stays up through the
 * slide-out so the panel glides, so it must not answer "is the view open" — a back press
 * inside the close window would be eaten as the view's own instead of navigating (the
 * result-tap test's find). */
let viewOpen = false;

const CLOSE_MS = 300;

function searchOpen() {
	return viewOpen;
}

/** Whether the history entry now current is the one this view pushed when it opened. */
function backEntryIsOurs() {
	return (history.state as {machloketSearchView?: boolean} | null)?.machloketSearchView === true;
}

/** The view's DOM, resting: the input back in the channel header, the row gone, the panel slid
 * out. No history operations — the caller decides whether the marker entry is consumed (a UI
 * close), left on top (a result tap into the same channel, which pushes nothing), or buried
 * under a navigation (which then closes through closeSearchOnNavigation). A stale marker is
 * transparent to Android back: consumeSearchPop skips past it.
 *
 * Safe to run twice; opening while a slide-out is still under way cancels its class drop. */
function teardown() {
	if (!installed) return;
	viewOpen = false;
	if (closeTimer) {
		clearTimeout(closeTimer);
		closeTimer = undefined;
	}
	const sideContainDiv = document.getElementById("sideContainDiv");
	const searchBox = document.getElementById("searchBox");
	const searchMeta = searchBox?.parentElement;
	// The input must be home in the header before the panel slides away, or it visibly rides
	// the panel out. (The row is the parent while the view is open; .searchMeta otherwise.)
	if (searchBox && !searchMeta?.classList.contains("searchMeta")) {
		const searchX = document.getElementById("searchX");
		searchX?.parentElement?.insertBefore(searchBox, searchX);
	}
	sideContainDiv?.querySelector(".searchViewRow")?.remove();
	deps?.onQueryClear();
	deps?.mSearch("");
	// The slide-out rides a class the SEARCH FLOW never touches: hideSearchDiv is stripped
	// by the flow itself twice over — synchronously by mSearch("")'s empty branch and again
	// ~100ms later by the debounced member-list rebuild (localuser's listque setTimeout) —
	// so riding the close on it let the async strip cancel the slide-out mid-window and the
	// panel sat revealed over the header (the review's blocker, round 2: reorder alone
	// couldn't beat the async strip). searchViewClosing just fails the reveal selector.
	sideContainDiv?.classList.add("searchViewClosing");
	// Only after the panel has slid out does the fixed-overlay geometry (and the class the
	// rest of the app keys on) go; until then the transition plays on the same properties.
	closeTimer = setTimeout(() => {
		closeTimer = undefined;
		page?.classList.remove("mobileSearchOpen");
		sideContainDiv?.classList.remove("searchViewClosing");
		sideContainDiv?.classList.remove("hideSearchDiv");
	}, CLOSE_MS);
}

function setSearchOpen(open: boolean) {
	if (!page) return;
	if (open && closeTimer) {
		// A slide-out is still under way (the class is up, the panel mid-fade): finish it at
		// once so this open starts from the rested state instead of dead-ending on the guard
		// and being closed by the timer a moment later.
		clearTimeout(closeTimer);
		closeTimer = undefined;
		page.classList.remove("mobileSearchOpen");
		const closing = document.getElementById("sideContainDiv");
		closing?.classList.remove("searchViewClosing");
		closing?.classList.remove("hideSearchDiv");
	}
	if (open === searchOpen()) return;
	if (open) {
		// The members view shares this panel and is reachable under this view's own trigger
		// (the header stays tappable while members is open); only one of them may show. It
		// hands over without a traversal, and its marker, when current, becomes ours.
		const tookMembersEntry = handOffMembersView();
		const sideContainDiv = document.getElementById("sideContainDiv");
		if (!sideContainDiv) return;
		// Search-panel residue would keep the reveal selector from matching (hideSearchDiv
		// from a result tap, searchViewClosing from an interrupted close).
		sideContainDiv.classList.remove("hideSearchDiv");
		sideContainDiv.classList.remove("searchViewClosing");
		const searchBox = document.getElementById("searchBox");
		if (!searchBox) return;
		const row = document.createElement("div");
		row.classList.add("flexltr", "searchViewRow");
		// The hit-target/glyph split the header uses (a padded wrapper, .svgicon glyph inside
		// — svgicon fills its container, so a bare span would size to the row).
		const back = document.createElement("span");
		back.classList.add("searchBack");
		back.onclick = () => setSearchOpen(false);
		const backGlyph = document.createElement("span");
		backGlyph.classList.add("svgicon", "svg-category");
		back.append(backGlyph);
		const clear = document.createElement("span");
		clear.classList.add("svgicon", "svg-plainx", "searchClear");
		clear.onclick = () => deps?.onQueryClear();
		row.append(back, searchBox, clear);
		sideContainDiv.prepend(row);
		// Android back then closes the view instead of leaving the channel (the entry below
		// is the channel view already on screen, so popping to it changes nothing) — unless
		// a stale marker from a same-channel result tap is current, which is REUSED: pushing
		// a second marker above it made two adjacent markers, and the back that skipped the
		// upper one handed the lower to goToState, which only understands channel states —
		// a TypeError and a dead press (the review's blocker). consumeSearchPop's skip rule
		// is the backstop for any adjacency that still slips through.
		if (tookMembersEntry) {
			history.replaceState({machloketSearchView: true}, "", location.href);
		} else if (!backEntryIsOurs()) {
			history.pushState({machloketSearchView: true}, "", location.href);
		}
		page.classList.add("mobileSearchOpen");
		viewOpen = true;
		// Discord's app opens the keyboard with the search; the input is the point of the view.
		searchBox.focus();
	} else {
		// Consume our own entry; the popstate it triggers is swallowed in consumeSearchPop.
		// When a navigation has pushed above the marker, the entry is no longer ours and the
		// marker stays buried — transparent to back via consumeSearchPop's skip rule.
		if (backEntryIsOurs()) {
			suppressPop = true;
			history.back();
		}
		teardown();
	}
}

/**
 * The entry's popstate handler runs this after the members view's guard: true when that pop
 * was this view's to take (closing it on Android back, skipping its bookkeeping entry, or
 * swallowing the pop a UI close triggered) and channel navigation stands down; false lets
 * navigation proceed.
 *
 * The marker can sit on top with the view already closed (a result tap into the same channel
 * pushes nothing) or between channel entries (navigation pushed above it while it was open);
 * in both a landing on it skips straight past — one back press, one visible result.
 */
export function consumeSearchPop(): boolean {
	if (suppressPop) {
		suppressPop = false;
		return true;
	}
	if (skipLanding) {
		skipLanding = false;
		// The entry a skip landed on can itself be one of our markers (adjacent markers —
		// prevented at the source by the open path's marker reuse; this is the backstop):
		// skipping only the upper one would hand the lower to channel navigation, which
		// dies on the marker state. Skip chained markers in one press.
		if (backEntryIsOurs()) {
			skipLanding = true;
			history.back();
			return true;
		}
		return false;
	}
	if (backEntryIsOurs()) {
		if (searchOpen()) teardown();
		skipLanding = true;
		history.back();
		return true;
	}
	if (installed && searchOpen()) {
		// Android back with the view open and our entry below the current one: this pop
		// walks the navigation stacked above the marker; the view closes with it.
		teardown();
		return true;
	}
	return false;
}

/**
 * Discord's app closes its search on any navigation. Called from the channel-load path where
 * it pushes history (addstate) — AFTER the push, like the members view's close (a close whose
 * back() raced the push destroyed the pushed entry; tracker 9c's round-4 blocker).
 */
export function closeSearchOnNavigation() {
	if (searchOpen()) setSearchOpen(false);
}

export function installSearchView(pageEl: HTMLElement, viewDeps: SearchViewDeps) {
	page = pageEl;
	deps = viewDeps;
	installed = true;
	// Installing re-derives the rested state (the #page class is animation state and may
	// linger; the logical state must not).
	viewOpen = false;

	// The header magnifier opens the view instead of expanding an input over the channel
	// name (the pre-18b mess). The intercept sits on .searchMeta in the CAPTURE phase: at the
	// target itself, capture and bubble listeners run in registration order, and the entry's
	// own handler (index.ts) is registered first — only an ancestor's capture reliably runs
	// ahead of it. stopPropagation keeps the entry's handler from expanding the header input.
	// No open-guard here: while the view is up this element is covered by the fixed panel,
	// and a tap during a slide-out (the class still present) is a reopen, which
	// setSearchOpen cancels the close for.
	document.querySelector(".searchMeta")?.addEventListener(
		"click",
		(event) => {
			event.preventDefault();
			event.stopPropagation();
			setSearchOpen(true);
		},
		{capture: true},
	);

	// A search result jumps to its message; the search flow's own handler runs the jump (and
	// hides the panel), but the view's DOM and state come down here first — without a history
	// operation, because a jump inside the same channel pushes nothing (channel.focus skips
	// the push when the channel doesn't change) and a cross-channel push must land above the
	// marker, not below a back() racing it.
	document.getElementById("sideDiv")?.addEventListener(
		"click",
		(event) => {
			if (!searchOpen()) return;
			if ((event.target as HTMLElement).closest("." + SEARCH_RESULT_CLASS)) teardown();
		},
		{capture: true},
	);

	installOverlaySwipe(pageEl, {
		isShown: searchOpen,
		hide: () => setSearchOpen(false),
		panel: () => document.getElementById("sideContainDiv"),
	});
}
