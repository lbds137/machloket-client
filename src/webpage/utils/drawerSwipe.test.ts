import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {installDrawerSwipe} = await import("./drawerSwipe");
const {Message} = await import("../message");

let page: HTMLElement;
let rail: HTMLElement;
let chat: HTMLElement;
let panel: HTMLElement;
let toggle: HTMLInputElement;

/** Where the chat panel rests with the drawer open (the mobile CSS puts it at 78vw). */
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

function install() {
	const openChat = vi.fn(() => {
		toggle.checked = true;
		panel.style.left = "0px";
	});
	installDrawerSwipe(page, {isOpen: () => !toggle.checked, openChat, panel: () => panel});
	return openChat;
}

describe("swiping the drawer shut", () => {
	it("opens the chat from a left swipe on the guild rail", async () => {
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);
		await glide();

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("opens the chat from a left swipe on the peeking chat", async () => {
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
		expect(panel.style.transition).toBe("");
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

describe("a message's swipe while the drawer is open", () => {
	const bindMessage = (setReplying = vi.fn()) => {
		const message = Object.assign(Object.create(Message.prototype), {
			owner: {moveForDrag: () => {}, setReplying},
		});
		message.messageevents(chat);
		return setReplying;
	};

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
