// The mobile member list is a transient view over the chat, on Discord's app model (tracker
// 9c): tapping the channel name opens it, the header's left icon is its back arrow while
// it is up, Android back and a right swipe close it, and a second right swipe — with the view
// gone — is the drawer's. The desktop layout keeps its own switch (#memberlisttoggle, a
// persisted preference); on mobile that checkbox stays untouched and the #page class is the
// one writer of this view.

import {installOverlaySwipe} from "./drawerSwipe.js";

let installed = false;
let suppressPop = false;
/** A marker entry is being skipped: the pop landing below it is real navigation. */
let skipLanding = false;
let page: HTMLElement | null = null;

function membersOpen() {
	return page?.classList.contains("mobileMembersOpen") ?? false;
}

/** Whether the history entry now current is the one this view pushed when it opened. */
function backEntryIsOurs() {
	return (history.state as {machloketMembersView?: boolean} | null)?.machloketMembersView === true;
}

function setMembersOpen(open: boolean) {
	if (!page || open === membersOpen()) return;
	if (open) {
		// Search-panel residue on the shared container would keep the slide-in selector
		// (`:not(.hideSearchDiv)`) from matching; opening the view explicitly clears it.
		document.getElementById("sideContainDiv")?.classList.remove("hideSearchDiv");
		// Android back then closes the view instead of leaving the channel (the entry below
		// is the channel view already on screen, so popping to it changes nothing).
		history.pushState({machloketMembersView: true}, "", location.href);
	} else if (backEntryIsOurs()) {
		// Consume our own entry; the popstate it triggers is swallowed in consumeMembersPop.
		suppressPop = true;
		history.back();
	}
	page.classList.toggle("mobileMembersOpen", open);
}

/**
 * The entry's popstate handler runs this first: true when that pop was this view's to take
 * (closing it on Android back, skipping its bookkeeping entry, or swallowing the pop a UI
 * close triggered) and channel navigation stands down; false lets navigation proceed.
 *
 * The marker entry can sit BETWEEN channel entries — navigation pushes above it while the
 * view stays open — so a pop landing on it skips straight past (the pop below then navigates,
 * one back press, one visible result) rather than counting as a dead press.
 */
export function consumeMembersPop(): boolean {
	if (suppressPop) {
		suppressPop = false;
		return true;
	}
	if (skipLanding) {
		skipLanding = false;
		return false;
	}
	if (backEntryIsOurs()) {
		if (membersOpen()) page?.classList.remove("mobileMembersOpen");
		skipLanding = true;
		history.back();
		return true;
	}
	if (installed && membersOpen()) {
		// Android back with the view open and our entry below the current one: this pop
		// walks the navigation stacked above the marker; the view closes with it.
		page?.classList.remove("mobileMembersOpen");
		return true;
	}
	return false;
}

/**
 * Discord's app closes its member overlay on any navigation. Called from the channel-load
 * path where it pushes history (addstate) — NOT from popstate replays, which walk history
 * the user already backed through and close the view through consumeMembersPop instead.
 */
export function closeMembersOnNavigation() {
	if (membersOpen()) setMembersOpen(false);
}

export function installMembersView(pageEl: HTMLElement) {
	page = pageEl;
	installed = true;

	const channelTitle = document.getElementById("channelTitle");
	channelTitle?.addEventListener("click", (event) => {
		// The topic inside the title keeps its own handler (a Dialog); a tap there is not a
		// request for this view.
		if ((event.target as HTMLElement).closest("#channelTopic")) return;
		if (!membersOpen()) setMembersOpen(true);
	});

	const backArrow = document.getElementById("maintoggleicon");
	backArrow?.addEventListener("click", (event) => {
		if (!membersOpen()) return;
		// While the view is up, the header's left icon is its back arrow, not the drawer
		// toggle; preventDefault stops the label from flipping #maintoggle.
		event.preventDefault();
		setMembersOpen(false);
	});

	// The header's other actions (pins, inbox, search) act on the chat, which this view
	// covers; on Discord's app the overlay owns the screen. A tap on them closes the view
	// first (capture, before their own handlers) and lets the action proceed on the chat.
	for (const id of ["pinnedMDiv", "inboxMDiv", "searchMeta"]) {
		document.getElementById(id)?.addEventListener(
			"click",
			() => {
				if (membersOpen()) setMembersOpen(false);
			},
			{capture: true},
		);
	}

	installOverlaySwipe(pageEl, {
		isShown: membersOpen,
		hide: () => setMembersOpen(false),
		panel: () => document.getElementById("sideContainDiv"),
	});
}
