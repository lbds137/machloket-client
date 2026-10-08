import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Contextmenu} = await import("./contextmenu");

const at = (target: HTMLElement, x: number, y: number) =>
	new Touch({identifier: 1, target, pageX: x, pageY: y, clientX: x, clientY: y});
function fire(target: HTMLElement, type: string, touches: Touch[], changed: Touch[]) {
	target.dispatchEvent(
		new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
	);
}
const LONG_PRESS = () => new Promise((res) => setTimeout(res, 600));

function bound() {
	const el = document.createElement("div");
	document.body.append(el);
	const menu = new Contextmenu<undefined, undefined>("long-press test");
	const opened = vi.spyOn(menu, "makemenu").mockImplementation(() => undefined);
	menu.bindContextmenu(el, undefined, undefined);
	return {el, opened};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("long-press opens the menu", () => {
	it("after an earlier drag on the same element too", async () => {
		const {el, opened} = bound();
		// A drag (a scroll, a swipe) that ends far from where it started.
		fire(el, "touchstart", [at(el, 100, 100)], [at(el, 100, 100)]);
		fire(el, "touchmove", [at(el, 100, 180)], [at(el, 100, 180)]);
		fire(el, "touchend", [], [at(el, 100, 180)]);

		// Then a stationary long-press.
		fire(el, "touchstart", [at(el, 100, 100)], [at(el, 100, 100)]);
		await LONG_PRESS();

		expect(opened).toHaveBeenCalledTimes(1);
		fire(el, "touchend", [], [at(el, 100, 100)]);
	});

	it("not when the system cancels the touch before the hold completes", async () => {
		const {el, opened} = bound();
		fire(el, "touchstart", [at(el, 100, 100)], [at(el, 100, 100)]);
		fire(el, "touchcancel", [], [at(el, 100, 100)]);
		await LONG_PRESS();

		expect(opened).not.toHaveBeenCalled();
	});
});

describe("a cancelled touch on a drag owner", () => {
	it("ends the drag with no movement, so a swipe-to-reply springs back without acting", () => {
		const el = document.createElement("div");
		document.body.append(el);
		const menu = new Contextmenu<undefined, undefined>("cancel test");
		const ended = vi.fn();
		menu.bindContextmenu(el, undefined, undefined, () => {}, ended);

		fire(el, "touchstart", [at(el, 200, 100)], [at(el, 200, 100)]);
		fire(el, "touchmove", [at(el, 120, 100)], [at(el, 120, 100)]);
		fire(el, "touchcancel", [], [at(el, 120, 100)]);

		expect(ended).toHaveBeenCalledTimes(1);
		expect(ended.mock.calls[0].slice(0, 2)).toEqual([0, 0]);
	});
});

describe("a second finger", () => {
	it("opens the menu once, not again when the first finger's hold runs out", async () => {
		const {el, opened} = bound();
		fire(el, "touchstart", [at(el, 100, 100)], [at(el, 100, 100)]);
		const second = new Touch({identifier: 2, target: el, pageX: 150, pageY: 150, clientX: 150, clientY: 150});
		fire(el, "touchstart", [at(el, 100, 100), second], [second]);
		await LONG_PRESS();

		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("kills an in-flight reply swipe: no lift of either finger acts on it", () => {
		const el = document.createElement("div");
		document.body.append(el);
		const menu = new Contextmenu<undefined, undefined>("two-finger drag test");
		const opened = vi.spyOn(menu, "makemenu").mockImplementation(() => undefined);
		let replied = false;
		menu.bindContextmenu(
			el,
			undefined,
			undefined,
			() => {},
			(x) => {
				// The message row's rule: a drag ending past -40 replies.
				if (x < -40) replied = true;
			},
		);

		// Finger A swipes left, short of the reply threshold…
		fire(el, "touchstart", [at(el, 200, 100)], [at(el, 200, 100)]);
		fire(el, "touchmove", [at(el, 170, 100)], [at(el, 170, 100)]);
		// …finger B lands on the row (the two-finger menu), A lifts, B drifts, B lifts.
		const b = new Touch({
			identifier: 2,
			target: el,
			pageX: 220,
			pageY: 140,
			clientX: 220,
			clientY: 140,
		});
		fire(el, "touchstart", [at(el, 200, 100), b], [b]);
		fire(el, "touchend", [b], [at(el, 200, 100)]);
		// B is touches[0] now; x re-seated at B's landing, so B's drift left of it reads as a
		// hard swipe — and B's lift fires it as a reply.
		fire(el, "touchmove", [at(el, 140, 140)], [at(el, 140, 140)]);
		fire(el, "touchend", [], [at(el, 140, 140)]);

		expect(replied).toBe(false);
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("doesn't stick: the next one-finger swipe still replies", () => {
		const el = document.createElement("div");
		document.body.append(el);
		const menu = new Contextmenu<undefined, undefined>("two-finger release test");
		vi.spyOn(menu, "makemenu").mockImplementation(() => undefined);
		let replied = false;
		menu.bindContextmenu(
			el,
			undefined,
			undefined,
			() => {},
			(x) => {
				if (x < -40) replied = true;
			},
		);

		// A full two-finger gesture…
		fire(el, "touchstart", [at(el, 200, 100)], [at(el, 200, 100)]);
		const b = new Touch({
			identifier: 2,
			target: el,
			pageX: 220,
			pageY: 140,
			clientX: 220,
			clientY: 140,
		});
		fire(el, "touchstart", [at(el, 200, 100), b], [b]);
		fire(el, "touchend", [b], [at(el, 200, 100)]);
		fire(el, "touchend", [], [b]);
		// …then a fresh one-finger swipe past the threshold.
		fire(el, "touchstart", [at(el, 200, 100)], [at(el, 200, 100)]);
		fire(el, "touchmove", [at(el, 150, 100)], [at(el, 150, 100)]);
		fire(el, "touchend", [], [at(el, 150, 100)]);

		expect(replied).toBe(true);
	});
});

describe("sliders", () => {
	const rendered = (opts: {startVal?: () => number}) => {
		const menu = new Contextmenu<undefined, undefined>("slider test");
		menu.addSlider("Volume", () => {}, undefined, undefined, opts);
		const div = document.createElement("div");
		menu.buttons[0].makeContextHTML(undefined, undefined, div, [], new WeakSet());
		return div.querySelector("input")!;
	};

	it("start at 100 when there's no start value", () => {
		expect(rendered({}).value).toBe("100");
	});

	it("start at the given value", () => {
		expect(rendered({startVal: () => 30}).value).toBe("30");
	});
});
