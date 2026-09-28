import {beforeEach, expect, it} from "vitest";
import {userEvent} from "vitest/browser";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MarkDown} = await import("./markdown");

let box: HTMLDivElement;
let md: InstanceType<typeof MarkDown>;

/** A composer box holding `text`, rendered the way the real one is (mentions as chips). */
async function mount(text: string) {
	document.querySelectorAll(".testMentionBox").forEach((el) => el.remove());
	box = document.createElement("div");
	box.className = "testMentionBox";
	box.contentEditable = "true";
	document.body.append(box);
	const session = {
		user: {},
		info: {},
		channelids: new Map(),
		getUser: async () => ({name: "alice", bind: () => {}}),
	};
	md = new MarkDown("", session as never, {keep: true});
	md.giveBox(box);
	md.txt = text;
	md.boxupdate(0, false);
	await new Promise((res) => setTimeout(res, 0));
	box.focus();
}

/** Puts the caret just after the mention chip (Discord: one Backspace from here removes it). */
function caretAfterChip() {
	const chip = box.querySelector("[real]")!;
	const range = new Range();
	range.setStartAfter(chip);
	range.collapse(true);
	getSelection()!.removeAllRanges();
	getSelection()!.addRange(range);
}

const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
// Chrome turns a space left at the end of an editable box into a no-break space.
const boxText = () => MarkDown.gatherBoxText(box).replace(/ /g, " ");

beforeEach(async () => {
	await mount("hi <@123>");
});

it("renders the mention as one chip", () => {
	const chip = box.querySelector("[real]")!;
	expect(chip.getAttribute("real")).toBe("<@123>");
	expect(chip.textContent).toBe("@alice");
});

it("deletes the whole mention with one Backspace key", async () => {
	caretAfterChip();
	await userEvent.keyboard("{Backspace}");
	await frame();

	expect(boxText()).toBe("hi ");
	expect(box.querySelector("[real]")).toBeNull();
});

// Android keyboards (SwiftKey, Gboard) send no Backspace keydown: Chrome reports key
// "Unidentified" and the deletion arrives only as a beforeinput deleteContentBackward.
it("deletes the whole mention on an Android keyboard's backspace", async () => {
	caretAfterChip();
	const event = new InputEvent("beforeinput", {
		inputType: "deleteContentBackward",
		bubbles: true,
		cancelable: true,
	});
	box.dispatchEvent(event);
	await frame();

	expect(event.defaultPrevented).toBe(true);
	expect(boxText()).toBe("hi ");
	expect(box.querySelector("[real]")).toBeNull();
});

it("leaves ordinary backspaces to the browser", async () => {
	await mount("hello");
	caretAtEnd();

	expect(androidDelete().defaultPrevented).toBe(false);
});

function caretAtEnd() {
	const range = new Range();
	range.selectNodeContents(box);
	range.collapse(false);
	getSelection()!.removeAllRanges();
	getSelection()!.addRange(range);
}

function androidDelete(inputType = "deleteContentBackward") {
	const event = new InputEvent("beforeinput", {inputType, bubbles: true, cancelable: true});
	box.dispatchEvent(event);
	return event;
}

it("deletes the mention from the end of the box, past the renderer's empty spans", async () => {
	caretAtEnd();
	expect(androidDelete().defaultPrevented).toBe(true);
	await frame();
	expect(boxText()).toBe("hi ");
});

it("deletes only the letter typed after a mention", async () => {
	await mount("hi <@123>x");
	caretAtEnd();
	expect(androidDelete().defaultPrevented).toBe(false);
	expect(box.querySelector("[real]")).not.toBeNull();
});

it("deletes the whole mention forward with Delete", async () => {
	await mount("<@123> hi");
	const range = new Range();
	range.setStartBefore(box.querySelector("[real]")!);
	range.collapse(true);
	getSelection()!.removeAllRanges();
	getSelection()!.addRange(range);
	expect(androidDelete("deleteContentForward").defaultPrevented).toBe(true);
	await frame();
	expect(boxText()).toBe(" hi");
});

it("deletes only the nearer of two adjacent mentions", async () => {
	await mount("<@123><@124>");
	caretAtEnd();
	expect(androidDelete().defaultPrevented).toBe(true);
	await frame();
	expect(boxText()).toBe("<@123>");
});

it("deletes a mention inside bold text", async () => {
	await mount("**hi <@123>**");
	caretAfterChip();
	expect(androidDelete().defaultPrevented).toBe(true);
	await frame();
	expect(box.querySelector("[real]")).toBeNull();
});

it("leaves a mention alone when a line break sits between it and the caret", async () => {
	await mount("<@123>\n");
	caretAtEnd();
	expect(androidDelete().defaultPrevented).toBe(false);
	expect(box.querySelector("[real]")).not.toBeNull();
});

// The edit-message box uses Chrome's plaintext-only mode (channel.ts, message.ts).
it("deletes the whole mention in a plaintext-only box", async () => {
	box.contentEditable = "plaintext-only";
	caretAfterChip();
	expect(androidDelete().defaultPrevented).toBe(true);
	await frame();
	expect(boxText()).toBe("hi ");
});
