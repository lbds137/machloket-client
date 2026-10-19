import {afterAll, beforeAll, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Message} = await import("./message.js");
const {I18n} = await import("./i18n");
await I18n.done;

type Entry = {text: string | (() => string); isVisible(m: unknown, arg: unknown): boolean};

/** A message in a channel where you may do anything, flagged ephemeral or not. */
function messageWith(flags: number) {
	const me = {id: "100"};
	const channel = {
		hasPermission: () => true,
		guild: {id: "@me", cachedContextCommands: () => [{}]},
		localuser: {user: me},
	};
	return Object.assign(Object.create(Message.prototype), {
		flags,
		pinned: false,
		author: {id: "300"},
		owner: channel,
	}) as InstanceType<typeof Message>;
}

// Report is a developer option; on here so its entry can show at all.
let developerSettings: string | null;
beforeAll(() => {
	developerSettings = localStorage.getItem("developerSettings");
	localStorage.setItem("developerSettings", JSON.stringify({reportSystem: true}));
});
afterAll(() => {
	if (developerSettings === null) localStorage.removeItem("developerSettings");
	else localStorage.setItem("developerSettings", developerSettings);
});

const entry = (label: string) =>
	(Message.contextmenu.buttons as unknown as Entry[]).find(
		(button) => (typeof button.text === "function" ? button.text() : button.text) === label,
	)!;

// An ephemeral message lives only on your screen (Discord's "Only you can see this"): the
// server has nothing to run an app on, react to, thread from, pin, delete or report, so none of it
// is offered.
for (const label of [
	I18n.message.apps(),
	I18n.message.reactionAdd(),
	I18n.message.createThread(),
	I18n.pinMessage(),
	I18n.message.delete(),
	I18n.message.report(),
]) {
	it(`an ephemeral message's menu has no "${label}"`, () => {
		expect(entry(label).isVisible(messageWith(0), undefined)).toBe(true);
		expect(entry(label).isVisible(messageWith(1 << 6), undefined)).toBe(false);
	});
}

it("an ephemeral message's hover bar offers no reaction or delete", () => {
	const toolbar = (flags: number) => {
		const message = messageWith(flags);
		const div = document.createElement("div");
		div.className = "messagediv";
		Object.assign(message, {div, reactions: [], type: 0});
		Object.assign(message.localuser, {favorites: {emojiReactFreq: () => [["👍", 1]]}});
		message.bindButtonEvent();
		div.dispatchEvent(new Event("mouseenter"));
		return div;
	};

	const plain = toolbar(0);
	expect(plain.querySelector(".messageButtons .svg-emoji")).not.toBeNull();
	expect(plain.querySelector(".messageButtons .svg-delete")).not.toBeNull();
	const ephemeral = toolbar(1 << 6);
	expect(ephemeral.querySelector(".messageButtons .svg-emoji")).toBeNull();
	expect(ephemeral.querySelector(".messageButtons .svg-delete")).toBeNull();
	expect(ephemeral.querySelector(".messageButtons button")).toBeNull();
});
