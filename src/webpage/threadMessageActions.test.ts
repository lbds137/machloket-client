import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Message} = await import("./message.js");
const {I18n} = await import("./i18n");
await I18n.done;

type Entry = {text: string | (() => string); isVisible(m: unknown, arg: unknown): boolean};

const ME = {id: "100"};
const THREAD_BITS = ["SEND_MESSAGES_IN_THREADS", "ADD_REACTIONS", "VIEW_CHANNEL"];

/** A real thread Channel, holding the permissions named. */
function threadChannel(
	threadData: {archived?: boolean; locked?: boolean} | undefined,
	granted: string[] = THREAD_BITS,
	type = 11,
) {
	const channel = Object.create(Channel.prototype);
	Object.assign(channel, {
		type,
		threadData,
		infinite: {snapBottom: () => () => {}},
		hasPermission: (name: string) => granted.includes(name),
	});
	Object.defineProperty(channel, "localuser", {
		value: {user: ME, favorites: noFavorites},
		configurable: true,
	});
	Object.defineProperty(channel, "guild", {
		value: {id: "1", cachedContextCommands: () => []},
	});
	return channel as InstanceType<typeof Channel>;
}
const noFavorites = {emojiReactFreq: () => [["👍", 1]]};

/** Your own plain message in that channel. */
function ownMessage(channel: InstanceType<typeof Channel>) {
	const div = document.createElement("div");
	div.className = "messagediv";
	return Object.assign(Object.create(Message.prototype), {
		flags: 0,
		pinned: false,
		type: 0,
		reactions: [],
		author: ME,
		owner: channel,
		div,
	}) as InstanceType<typeof Message>;
}

const menu = (message: InstanceType<typeof Message>, label: string) =>
	(Message.contextmenu.buttons as unknown as Entry[])
		.find((button) => (typeof button.text === "function" ? button.text() : button.text) === label)!
		.isVisible(message, undefined);

function hoverBar(message: InstanceType<typeof Message>) {
	message.bindButtonEvent();
	message.div!.dispatchEvent(new Event("mouseenter"));
	return message.div!;
}

const OPEN = {archived: false, locked: false};
const ARCHIVED = {archived: true, locked: false};
const LOCKED = {archived: false, locked: true};

// 50083 while archived, on an edit (server messages/#message_id/index.ts) and on adding a reaction
// (reactions.ts PUT). No permission lifts it.
it("an archived thread offers no edit, to a thread manager neither", () => {
	expect(ownMessage(threadChannel(OPEN)).canEdit()).toBe(true);
	expect(ownMessage(threadChannel(ARCHIVED)).canEdit()).toBe(false);
	const manager = [...THREAD_BITS, "MANAGE_THREADS"];
	expect(ownMessage(threadChannel(ARCHIVED, manager)).canEdit()).toBe(false);
});

it("an archived thread's menu and hover bar offer no edit or new reaction", () => {
	const open = ownMessage(threadChannel(OPEN));
	expect(menu(open, I18n.message.edit())).toBe(true);
	expect(menu(open, I18n.message.reactionAdd())).toBe(true);
	const openBar = hoverBar(open);
	expect(openBar.querySelector(".messageButtons .svg-edit")).not.toBeNull();
	expect(openBar.querySelector(".messageButtons .svg-emoji")).not.toBeNull();
	expect(
		openBar.querySelector(".messageButtons button .emoji, .messageButtons .vr-message"),
	).not.toBeNull();

	const archived = ownMessage(threadChannel(ARCHIVED));
	expect(menu(archived, I18n.message.edit())).toBe(false);
	expect(menu(archived, I18n.message.reactionAdd())).toBe(false);
	const bar = hoverBar(archived);
	expect(bar.querySelector(".messageButtons .svg-edit")).toBeNull();
	expect(bar.querySelector(".messageButtons .svg-emoji")).toBeNull();
	expect(bar.querySelector(".messageButtons .vr-message")).toBeNull();
});

// A send isn't refused in an archived thread: it unarchives it.
it("an archived thread still takes a send and a reply", () => {
	const channel = threadChannel(ARCHIVED);
	expect(channel.canMessage).toBe(true);
	expect(ownMessage(channel).canReply()).toBe(true);
	expect(hoverBar(ownMessage(channel)).querySelector(".messageButtons .svg-reply")).not.toBeNull();
});

function pill(message: InstanceType<typeof Message>, me: boolean) {
	const reactdiv = document.createElement("div");
	const toggle = vi.fn(async () => {});
	Object.assign(message, {
		reactions: [{count: 1, me, emoji: {name: "👍"}}],
		reactdiv: new WeakRef(reactdiv),
		reactionToggle: toggle,
	});
	message.updateReactions();
	return {reaction: reactdiv.querySelector(".reaction") as HTMLElement, toggle};
}

// reactions.ts refuses the PUT only, so your own reaction still comes off.
it("in an archived thread a pill of yours comes off and one of others' does nothing", () => {
	const yours = pill(ownMessage(threadChannel(ARCHIVED)), true);
	yours.reaction.click();
	expect(yours.toggle).toHaveBeenCalledOnce();
	expect(yours.reaction.classList.contains("reactionClosed")).toBe(false);

	const others = pill(ownMessage(threadChannel(ARCHIVED)), false);
	others.reaction.click();
	expect(others.toggle).not.toHaveBeenCalled();
	expect(others.reaction.classList.contains("reactionClosed")).toBe(true);

	const open = pill(ownMessage(threadChannel(OPEN)), false);
	open.reaction.click();
	expect(open.toggle).toHaveBeenCalledOnce();
	expect(open.reaction.classList.contains("reactionClosed")).toBe(false);
});

/** updateChannel on a real channel, with only the drawing it doesn't exercise stubbed. */
function threadUpdates(channel: InstanceType<typeof Channel>, messages: InstanceType<typeof Message>[]) {
	Object.assign(channel, {
		messages: new Map(messages.map((message, i) => [String(i), message])),
		renderIcon: () => {},
		slowmode: () => {},
		refreshComposerLock: () => {},
		fireEvents: () => {},
		nameSpan: new WeakRef(document.createElement("span")),
		permission_overwrites: new Map(),
	});
	Object.defineProperty(channel, "localuser", {
		value: {user: ME, favorites: noFavorites, channelids: new Map()},
	});
	return (thread_metadata: typeof OPEN) =>
		channel.updateChannel({type: 11, name: "t", thread_metadata} as never);
}

it("archiving and unarchiving redraw the pills, leaving messages not on the page alone", () => {
	const channel = threadChannel(OPEN);
	const message = ownMessage(channel);
	const {reaction} = pill(message, false);
	const reactdiv = reaction.parentElement!;
	expect(reaction.classList.contains("reactionClosed")).toBe(false);
	const undrawn = Object.assign(ownMessage(channel), {reactions: [{count: 1, me: false, emoji: {name: "👍"}}]});
	const update = threadUpdates(channel, [message, undrawn]);

	update(ARCHIVED);
	expect(reactdiv.querySelector(".reaction")!.classList.contains("reactionClosed")).toBe(true);

	update(OPEN);
	expect(reactdiv.querySelector(".reaction")!.classList.contains("reactionClosed")).toBe(false);
});

// channel.messages is the client's one map, every channel's messages in it.
it("a flip redraws this thread's pills only, and a thread's first update isn't a flip", () => {
	const channel = threadChannel(OPEN);
	const elsewhere = ownMessage(threadChannel(OPEN));
	const {reaction} = pill(elsewhere, false);
	const reactdiv = reaction.parentElement!;
	threadUpdates(channel, [elsewhere])(ARCHIVED);
	expect(reactdiv.querySelector(".reaction")).toBe(reaction);

	const fresh = threadChannel(undefined);
	const mine = ownMessage(fresh);
	const first = pill(mine, false);
	const freshDiv = first.reaction.parentElement!;
	threadUpdates(fresh, [mine])(OPEN);
	expect(freshDiv.querySelector(".reaction")).toBe(first.reaction);
});

it("an update that doesn't flip archived leaves the pills as they are", () => {
	const channel = threadChannel(OPEN);
	const message = ownMessage(channel);
	const {reaction} = pill(message, false);
	const reactdiv = reaction.parentElement!;
	const update = threadUpdates(channel, [message]);

	update(OPEN);
	update(LOCKED);

	expect(reactdiv.querySelector(".reaction")).toBe(reaction);
});

describe("the reply bar when the composer locks", () => {
	const IDS = ["typebox", "replybox", "upload", "gifTB", "stickerTB", "emojiTB", "mobileSend"];
	afterEach(() => IDS.forEach((id) => document.getElementById(id)?.remove()));

	function replying(threadData: typeof OPEN) {
		for (const id of IDS) {
			const element = document.createElement("div");
			element.id = id;
			document.body.append(element);
		}
		const channel = threadChannel(threadData);
		Object.assign(channel, {nsfwGated: () => false});
		Object.defineProperty(channel, "localuser", {value: {user: ME, channelfocus: channel}});
		const message = Object.assign(ownMessage(channel), {author: {...ME, username: "nyx"}});
		channel.setReplying(message);
		expect(document.getElementById("replybox")!.textContent).not.toBe("");
		return {channel, message};
	}

	// 160005 on the send it was for, and the composer it sits on no longer types.
	it("goes with the composer", () => {
		const {channel, message} = replying(OPEN);

		Object.assign(channel, {threadData: LOCKED});
		channel.refreshComposerLock();

		expect(channel.replyingto).toBeNull();
		expect(message.div!.classList.contains("replying")).toBe(false);
		expect(document.getElementById("replybox")!.textContent).toBe("");
	});

	// Any lock, not just a thread's: the send right gone, as a role change takes it.
	it("goes when the send right goes", () => {
		const {channel, message} = replying(OPEN);

		Object.assign(channel, {hasPermission: () => false});
		channel.refreshComposerLock();

		expect(channel.replyingto).toBeNull();
		expect(message.div!.classList.contains("replying")).toBe(false);
		expect(document.getElementById("replybox")!.textContent).toBe("");
	});

	it("stays while the composer still takes the send", () => {
		const {channel, message} = replying(OPEN);

		Object.assign(channel, {threadData: ARCHIVED});
		channel.refreshComposerLock();

		expect(channel.replyingto).toBe(message);
		expect(document.getElementById("replybox")!.textContent).not.toBe("");
	});
});

it("a pill that was open when drawn does nothing once the thread is archived", () => {
	const channel = threadChannel(OPEN);
	const {reaction, toggle} = pill(ownMessage(channel), false);
	channel.threadData = ARCHIVED as never;
	reaction.click();
	expect(toggle).not.toHaveBeenCalled();
});

// 160005 while locked without MANAGE_THREADS, on sends and edits; reactions aren't refused.
it("a locked thread takes sends and edits only from a thread manager", () => {
	const locked = threadChannel(LOCKED);
	expect(locked.canMessage).toBe(false);
	expect(ownMessage(locked).canEdit()).toBe(false);
	expect(ownMessage(locked).canReply()).toBe(false);

	const managed = threadChannel(LOCKED, [...THREAD_BITS, "MANAGE_THREADS"]);
	expect(managed.canMessage).toBe(true);
	expect(ownMessage(managed).canEdit()).toBe(true);
	expect(ownMessage(managed).canReply()).toBe(true);
});

it("a locked thread still offers reactions", () => {
	const message = ownMessage(threadChannel(LOCKED));
	expect(menu(message, I18n.message.reactionAdd())).toBe(true);
	expect(menu(message, I18n.message.edit())).toBe(false);
	expect(menu(message, I18n.reply())).toBe(false);
	const bar = hoverBar(message);
	expect(bar.querySelector(".messageButtons .svg-emoji")).not.toBeNull();
	expect(bar.querySelector(".messageButtons .svg-edit")).toBeNull();
	expect(bar.querySelector(".messageButtons .svg-reply")).toBeNull();
	const pillInLocked = pill(ownMessage(threadChannel(LOCKED)), false);
	pillInLocked.reaction.click();
	expect(pillInLocked.toggle).toHaveBeenCalledOnce();
});

it("a swipe replies only where a reply is offered", () => {
	const swipe = (channel: InstanceType<typeof Channel>) => {
		const replying = vi.fn();
		Object.assign(channel, {setReplying: replying});
		const el = document.createElement("div");
		document.body.append(el);
		ownMessage(channel).messageevents(el);
		const at = (x: number) =>
			new Touch({identifier: 1, target: el, pageX: x, pageY: 100, clientX: x, clientY: 100});
		const fire = (type: string, touches: Touch[], changed: Touch[]) =>
			el.dispatchEvent(
				new TouchEvent(type, {touches, changedTouches: changed, bubbles: true, cancelable: true}),
			);
		fire("touchstart", [at(200)], [at(200)]);
		fire("touchmove", [at(120)], [at(120)]);
		fire("touchend", [], [at(120)]);
		el.remove();
		return replying;
	};
	expect(swipe(threadChannel(OPEN))).toHaveBeenCalledOnce();
	expect(swipe(threadChannel(LOCKED))).not.toHaveBeenCalled();
});

// A thread's send right is SEND_MESSAGES_IN_THREADS, which a reply-only parent grants alone.
it("Reply follows a thread's own send right, not the channel bit", () => {
	const threadOnly = ownMessage(threadChannel(OPEN));
	expect(menu(threadOnly, I18n.reply())).toBe(true);
	expect(hoverBar(threadOnly).querySelector(".messageButtons .svg-reply")).not.toBeNull();

	const channelOnly = ownMessage(threadChannel(OPEN, ["SEND_MESSAGES", "VIEW_CHANNEL"]));
	expect(menu(channelOnly, I18n.reply())).toBe(false);
	expect(hoverBar(channelOnly).querySelector(".messageButtons .svg-reply")).toBeNull();
});

// The edit route asks for the send right first (server messages/#message_id/index.ts).
it("Edit needs the channel's send right too, your own message or not", () => {
	const withoutThreadBit = ownMessage(threadChannel(OPEN, ["SEND_MESSAGES", "VIEW_CHANNEL"]));
	expect(withoutThreadBit.canEdit()).toBe(false);
	const withoutChannelBit = ownMessage(
		threadChannel(undefined, ["SEND_MESSAGES_IN_THREADS", "VIEW_CHANNEL"], 0),
	);
	expect(withoutChannelBit.canEdit()).toBe(false);
});

it("a channel with no thread metadata is untouched", () => {
	const plain = threadChannel(undefined, ["SEND_MESSAGES", "ADD_REACTIONS", "VIEW_CHANNEL"], 0);
	expect(plain.canMessage).toBe(true);
	const message = ownMessage(plain);
	expect(message.canEdit()).toBe(true);
	expect(message.canReply()).toBe(true);
	expect(menu(message, I18n.message.reactionAdd())).toBe(true);
});
