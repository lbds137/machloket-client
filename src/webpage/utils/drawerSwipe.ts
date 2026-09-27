// The mobile layout slides between the drawer (guild rail + channel list, with the chat peeking
// at the edge) and the chat. A left swipe anywhere on the page while the drawer is open opens
// the chat, as in Discord's app. Before, only the channel list took it: the rail had none, and
// on the peeking chat the swipe started a reply to the message under the finger.

type Drawer = {isOpen(): boolean; openChat(): void};

/** Past this, a one-finger move counts as a gesture; horizontal when mostly sideways. */
const SLOP = 16;
const HORIZONTAL_RATIO = 1.5;
/** How far left a swipe must go to open the chat. */
const OPEN_DISTANCE = 45;

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
	page.addEventListener(
		"touchstart",
		(event) => {
			touchStartedInDrawer = drawer.isOpen();
			tracking = event.touches.length === 1 && touchStartedInDrawer;
			if (!tracking) return;
			gesture = "none";
			startX = event.touches[0].pageX;
			startY = event.touches[0].pageY;
			deltaX = 0;
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
			}
		},
		{passive: false, capture: true},
	);
	page.addEventListener(
		"touchend",
		() => {
			if (tracking && gesture === "horizontal" && deltaX < -OPEN_DISTANCE) drawer.openChat();
			tracking = false;
		},
		{capture: true},
	);
}
