import {beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

type Typebox = HTMLDivElement & {
	markdown: {owner?: unknown; rawString?: string; onUpdate: (str: string, pre: boolean) => void};
};

let composer: HTMLElement;
let typebox: Typebox;
let pending: HTMLElement;

/** The composer markup from app.html: the send button shows when the box lacks `noConent`. */
function mountComposer() {
	document.querySelectorAll(".testComposer").forEach((el) => el.remove());
	const page = document.createElement("div");
	page.className = "testComposer";
	page.innerHTML = `
		<div id="pasteimage" class="flexltr"></div>
		<div class="outerTypeBox noConent"><div id="typebox" contenteditable="true"></div></div>
		<div id="searchOptions"></div>`;
	document.body.append(page);
	composer = page.querySelector(".outerTypeBox")!;
	typebox = page.querySelector("#typebox") as Typebox;
	typebox.markdown = {onUpdate: () => {}};
	pending = page.querySelector("#pasteimage")!;
}

/** Runs the real mdBox on a session that only needs a no-op autocomplete search. */
function startComposer() {
	const session = Object.assign(Object.create(Localuser.prototype), {search: () => {}});
	session.mdBox();
	return session;
}

/** The box holds `raw`; `caretText` is what MarkDown passes the hook: only the text before the
 * caret, and left over from another box when the caret isn't in this one. */
function boxUpdate(raw: string, caretText = raw) {
	typebox.markdown.rawString = raw;
	typebox.markdown.onUpdate(caretText, false);
}

const settle = () => new Promise((res) => setTimeout(res, 0));
const sendShown = () => !composer.classList.contains("noConent");

beforeEach(mountComposer);

it("shows the send button for typed text, and hides it when the text is cleared", () => {
	startComposer();

	boxUpdate("hi");
	expect(sendShown()).toBe(true);
	boxUpdate("");
	expect(sendShown()).toBe(false);
});

it("goes by the box's text, not the text before the caret", () => {
	startComposer();

	boxUpdate("hi", "");
	expect(sendShown()).toBe(true);
	boxUpdate("", "left over from another box");
	expect(sendShown()).toBe(false);
});

it("shows the send button for an attachment with no text", async () => {
	startComposer();
	boxUpdate("");

	pending.append(document.createElement("div"));
	await settle();

	expect(sendShown()).toBe(true);
});

it("hides it again when the last attachment is removed and there's no text", async () => {
	startComposer();
	const attachment = document.createElement("div");
	pending.append(attachment);
	await settle();

	attachment.remove();
	await settle();

	expect(sendShown()).toBe(false);
});

it("keeps it for the text when an attachment goes", async () => {
	startComposer();
	boxUpdate("caption");
	const attachment = document.createElement("div");
	pending.append(attachment);
	await settle();

	attachment.remove();
	await settle();

	expect(sendShown()).toBe(true);
});

it("an account switch's new session drops the send button of an attachment gone while unloaded", async () => {
	const previous = startComposer();
	const attachment = document.createElement("div");
	pending.append(attachment);
	await settle();
	expect(sendShown()).toBe(true);

	// The switch: the old session stops watching, then the staged attachment goes.
	previous.disconnectComposer();
	attachment.remove();
	await settle();
	startComposer();

	expect(sendShown()).toBe(false);
});

it("a reconnect's READY keeps the send button for text already in the box", () => {
	startComposer();
	boxUpdate("draft");
	expect(sendShown()).toBe(true);

	startComposer();

	expect(sendShown()).toBe(true);
});

it("replaces its attachment watcher when it starts again (every READY) or unloads", () => {
	const session = startComposer();
	const first = session.pendingWatcher as MutationObserver;
	const disconnect = vi.spyOn(first, "disconnect");

	session.mdBox();

	expect(disconnect).toHaveBeenCalled();
	const second = session.pendingWatcher as MutationObserver;
	expect(second).not.toBe(first);
	const unloaded = vi.spyOn(second, "disconnect");
	session.disconnectComposer();
	expect(unloaded).toHaveBeenCalled();
});
