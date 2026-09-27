import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {installDrawerSwipe} = await import("./drawerSwipe");
const {Message} = await import("../message");

let page: HTMLElement;
let rail: HTMLElement;
let chat: HTMLElement;
let toggle: HTMLInputElement;

beforeEach(() => {
	document.querySelectorAll(".testPage").forEach((el) => el.remove());
	page = document.createElement("div");
	page.className = "testPage";
	// The mobile layout: #maintoggle checked = the chat is open; unchecked = the drawer is.
	page.innerHTML = `
		<input type="checkbox" id="maintoggle" />
		<div class="guildRail"></div>
		<div class="channelflex"><div class="scroller"></div></div>
		<div id="mainarea"><div class="scroller"><div class="message"></div></div></div>`;
	document.body.append(page);
	rail = page.querySelector(".guildRail")!;
	chat = page.querySelector(".message")!;
	toggle = page.querySelector("#maintoggle")!;
});

/** One finger from (x0, y0) to (x1, y1), as touchstart, a few touchmoves, touchend. */
function swipe(target: HTMLElement, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
	const at = (x: number, y: number) =>
		new Touch({identifier: 1, target, pageX: x, pageY: y, clientX: x, clientY: y});
	const fire = (type: string, touches: Touch[], changed: Touch[]) =>
		target.dispatchEvent(
			new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
		);
	fire("touchstart", [at(x0, y0)], [at(x0, y0)]);
	for (let step = 1; step <= 4; step++) {
		const x = x0 + ((x1 - x0) * step) / 4;
		const y = y0 + ((y1 - y0) * step) / 4;
		fire("touchmove", [at(x, y)], [at(x, y)]);
	}
	fire("touchend", [], [at(x1, y1)]);
}

function install() {
	const openChat = vi.fn(() => {
		toggle.checked = true;
	});
	installDrawerSwipe(page, {isOpen: () => !toggle.checked, openChat});
	return openChat;
}

describe("swiping the drawer shut", () => {
	it("opens the chat from a left swipe on the guild rail", () => {
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("opens the chat from a left swipe on the peeking chat", () => {
		const openChat = install();

		swipe(chat, [340, 300], [200, 296]);

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("ignores a vertical drag (scrolling the channel list)", () => {
		const openChat = install();

		swipe(rail, [200, 400], [190, 150]);

		expect(openChat).not.toHaveBeenCalled();
	});

	it("does nothing while the chat is already open", () => {
		toggle.checked = true;
		const openChat = install();

		swipe(rail, [300, 200], [150, 205]);

		expect(openChat).not.toHaveBeenCalled();
	});
});

describe("a message's swipe while the drawer is open", () => {
	it("doesn't start a reply", () => {
		install();
		const setReplying = vi.fn();
		const message = Object.assign(Object.create(Message.prototype), {
			owner: {moveForDrag: () => {}, setReplying},
		});
		message.messageevents(chat);

		swipe(chat, [340, 300], [200, 296]);

		expect(setReplying).not.toHaveBeenCalled();
	});

	it("opens the chat instead, though the message's own touch handling stops the event", () => {
		// Every message row (and guild icon, and channel row) is bound by Contextmenu, whose
		// touchstart stops propagation, so the page must see the touch in the capture phase.
		const openChat = install();
		const message = Object.assign(Object.create(Message.prototype), {
			owner: {moveForDrag: () => {}, setReplying: vi.fn()},
		});
		message.messageevents(chat);

		swipe(chat, [340, 300], [200, 296]);

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("opens the chat from a context-menu-bound guild icon on the rail", () => {
		const openChat = install();
		const icon = document.createElement("img");
		rail.append(icon);
		Message.contextmenu.bindContextmenu(icon, undefined as never);

		swipe(icon, [300, 200], [150, 205]);

		expect(openChat).toHaveBeenCalledTimes(1);
	});

	it("still starts a reply when the chat is open", () => {
		toggle.checked = true;
		install();
		const setReplying = vi.fn();
		const message = Object.assign(Object.create(Message.prototype), {
			owner: {moveForDrag: () => {}, setReplying},
		});
		message.messageevents(chat);

		swipe(chat, [340, 300], [200, 296]);

		expect(setReplying).toHaveBeenCalled();
	});
});
