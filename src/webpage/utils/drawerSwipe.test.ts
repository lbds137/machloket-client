import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {installDrawerSwipe, drawerSwipeJustEnded} = await import("./drawerSwipe");
const {Message} = await import("../message");

let page: HTMLElement;
let rail: HTMLElement;
let chat: HTMLElement;
let panel: HTMLElement;
let toggle: HTMLInputElement;

/** Where the chat panel rests with the drawer open. Prod is the full viewport width (9d); the
 * core takes geometry as a parameter, and this models a narrower rest to exercise it. */
const PEEK_LEFT = 280;

beforeEach(() => {
	document.querySelectorAll(".testPage").forEach((el) => el.remove());
	page = document.createElement("div");
	page.className = "testPage";
	// The mobile layout: #maintoggle checked = the chat is open; unchecked = the drawer is.
	page.innerHTML = `
		<input type="checkbox" id="maintoggle" />
		<div class="guildRail"></div>
		<div class="channelflex"><div class="scroller"></div></div>
		<div id="mainarea" style="position: absolute; top: 0; left: ${PEEK_LEFT}px; width: 360px; height: 600px">
			<div class="scroller"><div class="message">hello</div></div>
		</div>`;
	document.body.append(page);
	rail = page.querySelector(".guildRail")!;
	chat = page.querySelector(".message")!;
	panel = page.querySelector("#mainarea")!;
	toggle = page.querySelector("#maintoggle")!;
});

const at = (target: HTMLElement, x: number, y: number) =>
	new Touch({identifier: 1, target, pageX: x, pageY: y, clientX: x, clientY: y});
function fire(target: HTMLElement, type: string, touches: Touch[], changed: Touch[]) {
	target.dispatchEvent(
		new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
	);
}

/** One finger from (x0, y0) toward (x1, y1): touchstart and a few touchmoves, lifted unless `hold`. */
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
		// A real drag renders frames between moves; commit the styles so transitions start from here.
		getComputedStyle(panel).transform;
	}
	if (!hold) fire(target, "touchend", [], [at(target, x1, y1)]);
}

/** The panel's glide on release, plus a margin. */
const glide = () => new Promise((res) => setTimeout(res, 400));
const offsetX = () => new DOMMatrix(getComputedStyle(panel).transform).m41;

/** The chat on screen, as after opening it: #maintoggle checked and the panel at left 0. */
function chatOpen() {
	toggle.checked = true;
	panel.style.left = "0px";
}

function install() {
	const openChat = vi.fn(chatOpen);
	const closeChat = vi.fn(() => {
		toggle.checked = false;
		panel.style.left = `${PEEK_LEFT}px`;
	});
	installDrawerSwipe(page, {
		isOpen: () => !toggle.checked,
		openChat,
		closeChat,
		panel: () => panel,
		peekLeft: () => PEEK_LEFT,
	});
	return Object.assign(openChat, {closeChat});
}

describe("swiping the drawer shut", () => {
	it("opens the chat from a left swipe on the guild rail", async () => {
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("opens the chat from a left swipe on the hidden chat's edge", async () => {
		const openChat = install();

		swipe(chat, [340, 300], [200, 296]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("moves the chat with the finger while the swipe is under way", () => {
		install();

		swipe(rail, [300, 200], [180, 204], {hold: true});

		// Four moves of -30 px each: the last one leaves the panel 120 px left of where it rests.
		expect(offsetX()).toBe(-120);
		expect(panel.style.transition).toBe("none");
	});

	it("never drags the chat past fully open", () => {
		install();

		swipe(rail, [340, 200], [0, 204], {hold: true});

		expect(offsetX()).toBe(-PEEK_LEFT);
	});

	it("glides back and stays shut after a short swipe", async () => {
		const openChat = install();

		swipe(rail, [300, 200], [270, 202]);
		await glide();

		expect(openChat).not.toHaveBeenCalled();
		expect(panel.style.transform).toBe("");
	});

	it("leaves no drag offset behind once the chat is open", async () => {
		install();

		swipe(rail, [300, 200], [150, 205]);
		await glide();

		expect(panel.style.transform).toBe("");
		// The transition comes back a frame after the glide ends; a loaded machine renders that frame late.
		await vi.waitFor(() => expect(panel.style.transition).toBe(""));
	});

	it("finishes an opening glide at once when a new touch lands mid-glide", async () => {
		const openChat = install();
		swipe(rail, [300, 200], [150, 205]);
		await new Promise((res) => setTimeout(res, 50));

		// A second touch while the first glide is still under way: the chat opens right then, and
		// the touch (now on an open chat) isn't a drawer drag.
		swipe(rail, [300, 200], [270, 202], {hold: true});
		expect(openChat).toHaveBeenCalledTimes(1);
		expect(panel.style.transform).toBe("");
		fire(rail, "touchend", [], [at(rail, 270, 202)]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
		expect(panel.style.transform).toBe("");
	});

	it("measures a new drag from the true rest position after an interrupted spring-back", async () => {
		install();
		swipe(rail, [300, 200], [270, 202]);
		await new Promise((res) => setTimeout(res, 50));

		// Dragging all the way still reaches fully open (-PEEK_LEFT), not a mid-glide position.
		swipe(rail, [340, 200], [0, 204], {hold: true});

		expect(offsetX()).toBe(-PEEK_LEFT);
	});

	it("ignores a vertical drag (scrolling the channel list)", async () => {
		const openChat = install();

		swipe(rail, [200, 400], [190, 150]);
		await glide();

		expect(openChat).not.toHaveBeenCalled();
		expect(panel.style.transform).toBe("");
	});

	it("does nothing while the chat is already open", async () => {
		toggle.checked = true;
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);
		await glide();

		expect(openChat).not.toHaveBeenCalled();
		expect(panel.style.transform).toBe("");
	});
});

/** Binds the real message gestures to the chat's message row; returns its setReplying spy. */
function bindMessage(setReplying = vi.fn()) {
	const message = Object.assign(Object.create(Message.prototype), {owner: {setReplying}});
	message.messageevents(chat);
	return setReplying;
}

describe("a message's swipe while the drawer is open", () => {
	it("doesn't start a reply", async () => {
		install();
		const setReplying = bindMessage();

		swipe(chat, [340, 300], [200, 296]);
		await glide();

		expect(setReplying).not.toHaveBeenCalled();
	});

	it("opens the chat instead, though the message's own touch handling stops the event", async () => {
		// Every message row (and guild icon, and channel row) is bound by Contextmenu, whose
		// touchstart stops propagation, so the page must see the touch in the capture phase.
		const openChat = install();
		bindMessage();

		swipe(chat, [340, 300], [200, 296]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("opens the chat from a context-menu-bound guild icon on the rail", async () => {
		const openChat = install();
		const icon = document.createElement("img");
		rail.append(icon);
		Message.contextmenu.bindContextmenu(icon, undefined as never);

		swipe(icon, [300, 200], [150, 205]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("still starts a reply when the chat is open", async () => {
		toggle.checked = true;
		install();
		const setReplying = bindMessage();

		swipe(chat, [340, 300], [200, 296]);
		await glide();

		expect(setReplying).toHaveBeenCalled();
	});
});

describe("swiping the chat back to the drawer", () => {
	it("follows the finger rightward, then closes the chat after the glide", async () => {
		chatOpen();
		const {closeChat} = install();

		swipe(chat, [40, 300], [160, 304], {hold: true});
		expect(offsetX()).toBe(120);
		fire(chat, "touchend", [], [at(chat, 160, 304)]);
		await glide();

		expect(closeChat).toHaveBeenCalledTimes(1);
		expect(panel.style.transform).toBe("");
	});

	it("never drags the chat past where it rests beside the drawer", () => {
		chatOpen();
		install();

		swipe(chat, [10, 300], [400, 304], {hold: true});

		expect(offsetX()).toBe(PEEK_LEFT);
	});

	it("springs back and stays open after a short swipe", async () => {
		chatOpen();
		const {closeChat} = install();

		swipe(chat, [40, 300], [70, 302]);
		await glide();

		expect(closeChat).not.toHaveBeenCalled();
		expect(panel.style.transform).toBe("");
	});

	it("closes from a right swipe that starts on a message, and doesn't reply", async () => {
		chatOpen();
		const {closeChat} = install();
		const setReplying = bindMessage();

		swipe(chat, [40, 300], [180, 304]);
		await glide();

		expect(closeChat).toHaveBeenCalledTimes(1);
		expect(setReplying).not.toHaveBeenCalled();
	});
});

describe("swipe to reply", () => {
	beforeEach(() => {
		// Headless Chromium may lack navigator.vibrate; the app treats it as optional.
		Object.defineProperty(navigator, "vibrate", {value: vi.fn(() => true), configurable: true});
	});

	it("replies on a left swipe on a message with the chat open, and leaves the chat alone", async () => {
		chatOpen();
		const {closeChat} = install();
		const setReplying = bindMessage();

		swipe(chat, [300, 300], [200, 302]);
		await glide();

		expect(setReplying).toHaveBeenCalledTimes(1);
		expect(closeChat).not.toHaveBeenCalled();
		expect(offsetX()).toBe(0);
	});

	it("vibrates once, as the swipe passes the reply threshold", () => {
		chatOpen();
		install();
		bindMessage();

		swipe(chat, [300, 300], [150, 302], {hold: true});

		expect(navigator.vibrate).toHaveBeenCalledTimes(1);
	});

	it("doesn't vibrate for a swipe too short to reply", () => {
		chatOpen();
		install();
		bindMessage();

		swipe(chat, [300, 300], [270, 302]);

		expect(navigator.vibrate).not.toHaveBeenCalled();
	});

	it("doesn't vibrate for drawer swipes", async () => {
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);
		await glide();
		swipe(chat, [40, 300], [180, 304]);
		await glide();

		expect(openChat).toHaveBeenCalled();
		expect(openChat.closeChat).toHaveBeenCalled();
		expect(navigator.vibrate).not.toHaveBeenCalled();
	});

	it("glides the message back rather than snapping", () => {
		chatOpen();
		install();
		bindMessage();

		swipe(chat, [300, 300], [200, 302]);

		expect(chat.style.transition).toContain("translate");
	});
});

describe("the click a phone makes at the end of a swipe", () => {
	it("is reported as the swipe's own for a moment after a drawer swipe ends", async () => {
		chatOpen();
		install();

		swipe(chat, [40, 300], [180, 304]);

		expect(drawerSwipeJustEnded()).toBe(true);
		await new Promise((res) => setTimeout(res, 450));
		expect(drawerSwipeJustEnded()).toBe(false);
	});

	it("doesn't reach a channel row's click handler right after a close swipe", () => {
		chatOpen();
		install();
		const row = document.createElement("div");
		rail.append(row);
		const onRowClick = vi.fn();
		row.addEventListener("click", onRowClick);

		swipe(chat, [40, 300], [180, 304]);
		row.click();

		expect(onRowClick).not.toHaveBeenCalled();
	});

	it("isn't claimed after a plain tap or a vertical scroll", async () => {
		// Let the previous test's swipe window lapse (the timestamp is module-wide).
		await new Promise((res) => setTimeout(res, 450));
		install();

		swipe(rail, [200, 400], [190, 150]);

		expect(drawerSwipeJustEnded()).toBe(false);
	});
});

describe("a message after its reply swipe", () => {
	it("drops the glide-back transition once the glide is done", async () => {
		chatOpen();
		install();
		bindMessage();

		swipe(chat, [300, 300], [200, 302]);
		await new Promise((res) => setTimeout(res, 300));

		await vi.waitFor(() => expect(chat.style.transition).toBe(""));
	});
});

describe("a cancelled drawer drag", () => {
	it("glides back to rest without switching views", async () => {
		// Android's edge-back gesture (or any system gesture) cancels the touch mid-drag.
		const openChat = install();

		swipe(rail, [300, 200], [150, 205], {hold: true});
		expect(offsetX()).toBe(-150);
		fire(rail, "touchcancel", [], [at(rail, 150, 205)]);
		await glide();

		expect(openChat).not.toHaveBeenCalled();
		expect(offsetX()).toBe(0);
		await vi.waitFor(() => expect(panel.style.transition).toBe(""));
	});
});

describe("a second finger during a drawer drag", () => {
	it("springs the panel back instead of leaving it mid-offset", async () => {
		const openChat = install();

		swipe(rail, [300, 200], [150, 205], {hold: true});
		const second = new Touch({identifier: 2, target: rail, pageX: 50, pageY: 400});
		fire(rail, "touchstart", [at(rail, 150, 205), second], [second]);
		await glide();

		expect(openChat).not.toHaveBeenCalled();
		expect(offsetX()).toBe(0);
		expect(panel.style.transform).toBe("");
	});
});
