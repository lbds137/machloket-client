import {beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

type Typebox = HTMLDivElement & {
	markdown: {owner?: unknown; onUpdate: (str: string, pre: boolean) => void};
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

const settle = () => new Promise((res) => setTimeout(res, 0));
const sendShown = () => !composer.classList.contains("noConent");

beforeEach(mountComposer);

it("shows the send button for typed text, and hides it when the text is cleared", () => {
	startComposer();

	typebox.markdown.onUpdate("hi", false);
	expect(sendShown()).toBe(true);
	typebox.markdown.onUpdate("", false);
	expect(sendShown()).toBe(false);
});

it("shows the send button for an attachment with no text", async () => {
	startComposer();
	typebox.markdown.onUpdate("", false);

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
	typebox.markdown.onUpdate("caption", false);
	const attachment = document.createElement("div");
	pending.append(attachment);
	await settle();

	attachment.remove();
	await settle();

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
