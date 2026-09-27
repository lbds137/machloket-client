// The mobile layout slides between the drawer (guild rail + channel list, with the chat peeking
// at the edge) and the chat. A left swipe anywhere on the page while the drawer is open opens
// the chat, as in Discord's app. Before, only the channel list took it: the rail had none, and
// on the peeking chat the swipe started a reply to the message under the finger.

type Drawer = {
	isOpen(): boolean;
	openChat(): void;
	/** The chat panel, which follows the finger during the swipe. */
	panel(): HTMLElement | null;
};

/** Past this, a one-finger move counts as a gesture; horizontal when mostly sideways. */
const SLOP = 16;
const HORIZONTAL_RATIO = 1.5;
/** How far left a swipe must go to open the chat. */
const OPEN_DISTANCE = 45;
/** The panel's glide from where the finger let go to open or back. */
const GLIDE_MS = 180;

/** Whether the current touch began with the drawer open (then the drawer owns it). */
let touchStartedInDrawer = false;

/**
 * For other touch handlers (message swipes): whether the drawer owns the current touch. Latched
 * at touchstart, since the drawer's own touchend (capture phase) opens the chat before a
 * message's touchend runs. Always false outside the mobile layout (not installed).
 */
export function drawerOwnsTouch() {
	return touchStartedInDrawer;
}

export function installDrawerSwipe(page: HTMLElement, drawer: Drawer) {
	// Capture phase: message rows, guild icons and channel rows are bound by Contextmenu, whose
	// touchstart stops propagation, so a bubbling listener here would never see those touches.
	let tracking = false;
	let gesture: "none" | "horizontal" | "vertical" = "none";
	let startX = 0;
	let startY = 0;
	let deltaX = 0;
	/** How far the panel sits from the left edge at rest: the most a drag can move it. */
	let restLeft = 0;
	/** Ends the release glide still under way, if any, where it was heading. */
	let finishGlide: (() => void) | undefined;
	page.addEventListener(
		"touchstart",
		(event) => {
			// A touch mid-glide lands on the settled state: otherwise it would measure a moving panel,
			// and the old glide's fallback could open the chat under the new gesture.
			finishGlide?.();
			finishGlide = undefined;
			touchStartedInDrawer = drawer.isOpen();
			tracking = event.touches.length === 1 && touchStartedInDrawer;
			if (!tracking) return;
			gesture = "none";
			startX = event.touches[0].pageX;
			startY = event.touches[0].pageY;
			deltaX = 0;
			restLeft = drawer.panel()?.getBoundingClientRect().left ?? 0;
		},
		{passive: true, capture: true},
	);
	page.addEventListener(
		"touchmove",
		(event) => {
			if (!tracking || event.touches.length !== 1) return;
			const dx = event.touches[0].pageX - startX;
			const dy = event.touches[0].pageY - startY;
			if (gesture === "none" && (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP)) {
				gesture = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? "horizontal" : "vertical";
			}
			if (gesture === "horizontal") {
				deltaX = dx;
				// Keeps the channel list from scrolling sideways under the swipe.
				event.preventDefault();
				const panel = drawer.panel();
				if (panel) {
					// A transform, not `left`: it moves on the compositor, without a layout each frame.
					panel.style.transition = "none";
					panel.style.transform = `translateX(${Math.max(Math.min(dx, 0), -restLeft)}px)`;
				}
			}
		},
		{passive: false, capture: true},
	);
	page.addEventListener(
		"touchend",
		() => {
			if (!tracking) return;
			tracking = false;
			if (gesture !== "horizontal") return;
			const open = deltaX < -OPEN_DISTANCE;
			const panel = drawer.panel();
			if (panel) finishGlide = settle(panel, open, restLeft, drawer);
			else if (open) drawer.openChat();
		},
		{capture: true},
	);
}

/**
 * Glides the panel from where the finger let go to fully open (then really opens) or back.
 * Returns a function that ends the glide at once where it was heading (a new touch calls it).
 */
function settle(panel: HTMLElement, open: boolean, restLeft: number, drawer: Drawer) {
	panel.style.transition = `transform ${GLIDE_MS}ms ease-out`;
	panel.style.transform = `translateX(${open ? -restLeft : 0}px)`;
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		clearTimeout(fallback);
		panel.removeEventListener("transitionend", finish);
		// Swap the offset for the real position in one frame, with no transition, so the panel
		// doesn't move; then give the stylesheet its own transition back.
		panel.style.transition = "none";
		if (open) drawer.openChat();
		panel.style.removeProperty("transform");
		// Commit that frame's styles now: otherwise the browser may apply it together with the
		// restored transition below, and replay the stylesheet's `left` animation from the drawer.
		void panel.offsetWidth;
		requestAnimationFrame(() => panel.style.removeProperty("transition"));
	};
	panel.addEventListener("transitionend", finish);
	// transitionend never comes if the transition is cancelled (e.g. a new drag sets `none`).
	const fallback = setTimeout(finish, GLIDE_MS + 60);
	return finish;
}
