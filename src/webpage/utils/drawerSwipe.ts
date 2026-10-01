// The mobile layout slides between the drawer (guild rail + channel list, the chat fully off
// screen beside it) and the chat. As in Discord's app, the chat follows the finger both ways:
// a left swipe anywhere while the drawer is open opens the chat, and a right swipe on the open
// chat takes it back to the drawer. A left swipe on a message with the chat open is the
// message's own (swipe to reply, message.ts); drawerOwnsTouch() tells it whose touches are
// the drawer's.

type Drawer = {
	isOpen(): boolean;
	openChat(): void;
	closeChat(): void;
	/** The chat panel, which follows the finger during the swipe. */
	panel(): HTMLElement | null;
	/** Where the panel's left edge rests while the drawer is open. */
	peekLeft(): number;
};

/** Past this, a one-finger move counts as a gesture; horizontal when mostly sideways. */
const SLOP = 16;
const HORIZONTAL_RATIO = 1.5;
/** How far a swipe must go to switch between the drawer and the chat. */
const SWITCH_DISTANCE = 45;
/** The panel's glide from where the finger let go to its destination. */
const GLIDE_MS = 180;

/**
 * Whether the drawer owns the current touch: any touch that began with the drawer open, or a
 * rightward swipe on the open chat. Kept until the next touchstart, since the drawer's own
 * touchend (capture phase) switches views before a message's touchend runs.
 */
let drawerOwnsIt = false;

/** For message swipes: whether the drawer owns the current touch (false outside mobile). */
export function drawerOwnsTouch() {
	return drawerOwnsIt;
}

/** A phone can fire a click at the end of a swipe; this long after one, a click is the swipe's. */
const SWIPE_CLICK_MS = 250;
let lastSwipeEnd = -Infinity;

/**
 * For click handlers on the drawer and the off-screen chat edge: whether a drawer swipe just ended, so
 * the click that follows it isn't a tap (it would undo the swipe). Time-limited, unlike the old
 * flag that swallowed the next real tap whenever it came.
 */
export function drawerSwipeJustEnded() {
	return performance.now() - lastSwipeEnd < SWIPE_CLICK_MS;
}

/** A full-width overlay over the chat (the mobile member list) whose own right swipe closes
 * it. While the overlay is shown it outranks the drawer's swipe: both installs listen on the
 * page, and without the claim a right swipe would close the chat to the drawer underneath the
 * overlay (tracker 9c's original complaint). */
type Overlay = {
	isShown(): boolean;
	hide(): void;
	/** The overlay panel, which follows the finger during the closing swipe. */
	panel(): HTMLElement | null;
};

let overlay: Overlay | null = null;

export function installDrawerSwipe(page: HTMLElement, drawer: Drawer) {
	// Capture phase: message rows, guild icons and channel rows are bound by Contextmenu, whose
	// touchstart stops propagation, so a bubbling listener here would never see those touches.
	/** Which way this touch could switch: open the chat (drawer showing) or close it. */
	let mode: "open" | "close" | "none" = "none";
	let gesture: "none" | "horizontal" | "vertical" = "none";
	let startX = 0;
	let startY = 0;
	let deltaX = 0;
	/** How far the panel may travel in this swipe: to fully open, or back beside the drawer. */
	let travel = 0;
	/** Ends the release glide still under way, if any, where it was heading. */
	let finishGlide: (() => void) | undefined;
	page.addEventListener(
		"touchstart",
		(event) => {
			// A touch mid-glide lands on the settled state: otherwise it would measure a moving panel,
			// and the old glide could switch views under the new gesture.
			finishGlide?.();
			finishGlide = undefined;
			gesture = "none";
			deltaX = 0;
			if (event.touches.length !== 1 || overlay?.isShown()) {
				mode = "none";
				drawerOwnsIt = false;
				return;
			}
			mode = drawer.isOpen() ? "open" : "close";
			drawerOwnsIt = mode === "open";
			startX = event.touches[0].pageX;
			startY = event.touches[0].pageY;
			travel =
				mode === "open" ? (drawer.panel()?.getBoundingClientRect().left ?? 0) : drawer.peekLeft();
		},
		{passive: true, capture: true},
	);
	page.addEventListener(
		"touchmove",
		(event) => {
			if (mode === "none" || event.touches.length !== 1) return;
			const dx = event.touches[0].pageX - startX;
			const dy = event.touches[0].pageY - startY;
			if (gesture === "none" && (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP)) {
				gesture = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? "horizontal" : "vertical";
				// On the open chat only a rightward swipe is the drawer's; leftward is reply.
				if (mode === "close" && gesture === "horizontal" && dx < 0) mode = "none";
				drawerOwnsIt = mode === "open" || (mode === "close" && gesture === "horizontal");
			}
			if (gesture !== "horizontal" || mode === "none") return;
			deltaX = dx;
			// Keeps the lists from scrolling sideways under the swipe.
			event.preventDefault();
			const panel = drawer.panel();
			if (!panel) return;
			// A transform, not `left`: it moves on the compositor, without a layout each frame.
			const offset =
				mode === "open" ? Math.max(Math.min(dx, 0), -travel) : Math.min(Math.max(dx, 0), travel);
			panel.style.transition = "none";
			panel.style.transform = `translateX(${offset}px)`;
		},
		{passive: false, capture: true},
	);
	// Swallow that trailing click before any handler sees it (capture), wherever it lands: the
	// channel list and the chat's edge both switch views on click.
	page.addEventListener(
		"click",
		(event) => {
			if (!drawerSwipeJustEnded()) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		{capture: true},
	);
	page.addEventListener(
		"touchend",
		() => {
			if (mode === "none" || gesture !== "horizontal") {
				mode = "none";
				return;
			}
			lastSwipeEnd = performance.now();
			const switching = mode === "open" ? deltaX < -SWITCH_DISTANCE : deltaX > SWITCH_DISTANCE;
			const target = switching ? (mode === "open" ? -travel : travel) : 0;
			const commit = !switching
				? undefined
				: mode === "open"
					? () => drawer.openChat()
					: () => drawer.closeChat();
			mode = "none";
			const panel = drawer.panel();
			if (panel) finishGlide = settle(panel, target, commit);
			else commit?.();
		},
		{capture: true},
	);
}

/** The overlay's closing swipe: with the overlay shown, a rightward drag slides it out
 * finger-following, and a swipe past SWITCH_DISTANCE glides it off and hides it. Leftward and
 * vertical drags are not claimed (the list scrolls; Discord opens members by tap only). */
export function installOverlaySwipe(page: HTMLElement, view: Overlay) {
	overlay = view;
	let gesture: "none" | "horizontal" | "vertical" = "none";
	/** Whether this touch actually dragged the panel (only the closing direction does). */
	let claimed = false;
	let startX = 0;
	let startY = 0;
	let deltaX = 0;
	/** How far the panel may travel: its own width, fully off screen. */
	let travel = 0;
	/** Ends the release glide still under way, if any, where it was heading. */
	let finishGlide: (() => void) | undefined;
	page.addEventListener(
		"touchstart",
		(event) => {
			finishGlide?.();
			finishGlide = undefined;
			gesture = "none";
			claimed = false;
			deltaX = 0;
			if (event.touches.length !== 1 || !view.isShown()) return;
			startX = event.touches[0].pageX;
			startY = event.touches[0].pageY;
			travel = view.panel()?.getBoundingClientRect().width ?? 0;
		},
		{passive: true, capture: true},
	);
	page.addEventListener(
		"touchmove",
		(event) => {
			if (!view.isShown() || event.touches.length !== 1) return;
			const dx = event.touches[0].pageX - startX;
			const dy = event.touches[0].pageY - startY;
			if (gesture === "none" && (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP)) {
				gesture = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? "horizontal" : "vertical";
				// Claim it from anything under the overlay, as the drawer's swipe does.
				drawerOwnsIt = gesture === "horizontal";
			}
			// Only the closing direction follows the finger.
			if (gesture !== "horizontal" || dx <= 0) return;
			deltaX = dx;
			claimed = true;
			event.preventDefault();
			const panel = view.panel();
			if (!panel) return;
			panel.style.transition = "none";
			panel.style.transform = `translateX(${Math.min(dx, travel)}px)`;
		},
		{passive: false, capture: true},
	);
	/** Springs an unfinished drag back where it came from: a lift that didn't switch, or a
	 * system-cancelled touch, which otherwise leaves the inline transform behind. */
	const release = () => {
		if (!view.isShown() || gesture !== "horizontal" || !claimed) {
			gesture = "none";
			claimed = false;
			return;
		}
		lastSwipeEnd = performance.now();
		const switching = deltaX > SWITCH_DISTANCE;
		const target = switching ? travel : 0;
		gesture = "none";
		claimed = false;
		const panel = view.panel();
		const commit = switching ? () => view.hide() : undefined;
		if (panel) finishGlide = settle(panel, target, commit);
		else commit?.();
	};
	page.addEventListener("touchend", release, {capture: true});
	page.addEventListener("touchcancel", release, {capture: true});
}

/**
 * Glides the panel from where the finger let go to `target`, then runs `commit` (switching the
 * view the CSS way) and drops the offset. Returns a function that ends it at once, for a new touch.
 */
function settle(panel: HTMLElement, target: number, commit: (() => void) | undefined) {
	panel.style.transition = `transform ${GLIDE_MS}ms ease-out`;
	panel.style.transform = `translateX(${target}px)`;
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		clearTimeout(fallback);
		panel.removeEventListener("transitionend", finish);
		// Swap the offset for the real position in one frame, with no transition, so the panel
		// doesn't move; then give the stylesheet its own transition back.
		panel.style.transition = "none";
		commit?.();
		panel.style.removeProperty("transform");
		// Commit that frame's styles now: otherwise the browser may apply it together with the
		// restored transition below, and replay the stylesheet's `left` animation.
		void panel.offsetWidth;
		requestAnimationFrame(() => panel.style.removeProperty("transition"));
	};
	panel.addEventListener("transitionend", finish);
	// transitionend never comes if the transition is cancelled (e.g. a new drag sets `none`).
	const fallback = setTimeout(finish, GLIDE_MS + 60);
	return finish;
}
