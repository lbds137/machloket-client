import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	// Statics live on the shared Channel class across a worker's test files.
	Channel.historyCooldownUntil = 0;
	document.getElementById("scrollWrap")?.remove();
	document.getElementById("loadingdiv")?.remove();
	for (const id of [
		"typebox",
		"typediv",
		"upload",
		"gifTB",
		"stickerTB",
		"emojiTB",
		"mobileSend",
		"chatArea",
		"voiceArea",
		"channelTopic",
		"pinnedMDiv",
		"realbox",
	]) {
		document.getElementById(id)?.remove();
	}
});

/** The focused channel's view with the skeleton up and the opening page refused. */
function refusedChannel() {
	for (const id of ["scrollWrap", "loadingdiv"]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}
	const localuser: {channelfocus?: unknown} = {};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {localuser},
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
		lastreadmessageid: undefined,
		firstPageRefused: true,
		infinite: {getDiv: async () => document.createElement("div"), delete: async () => {}},
		focus: async () => {},
	}) as InstanceType<typeof Channel>;
	Object.defineProperty(channel, "localuser", {
		value: localuser,
		writable: true,
		configurable: true,
	});
	localuser.channelfocus = channel;
	document.getElementById("loadingdiv")!.classList.add("loading");
	Channel.historyCooldownUntil = 0;
	return channel;
}

/** Focused channel view with full DOM and stub scaffold needed by getHTML. */
function scaffoldedChannel() {
	const channel = refusedChannel();

	for (const id of [
		"typediv",
		"upload",
		"gifTB",
		"stickerTB",
		"emojiTB",
		"mobileSend",
		"chatArea",
		"voiceArea",
		"pinnedMDiv",
		"realbox",
	]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}

	const topic = document.createElement("span");
	topic.id = "channelTopic";
	document.body.append(topic);

	const typebox = document.createElement("div");
	typebox.id = "typebox";
	Object.assign(typebox, {
		markdown: {
			boxEnabled: true,
			boxupdate: () => {},
			txt: "",
			owner: undefined,
		},
	});
	document.body.append(typebox);

	const localuser = {
		channelfocus: undefined,
		fileExtange: () => {},
		pageTitle: () => {},
		getSidePannel: () => {},
		voiceAllowed: true,
		user: {nsfw_allowed: true},
		lookingguild: undefined,
		memberListUpdate: () => {},
	};

	const guild = {
		loadChannel: () => {},
		loadGuild: () => {},
		prevchannel: undefined,
		perminfo: {prevchannel: undefined, nsfwOk: true},
		properties: {name: "guild"},
		localuser,
	};

	Object.defineProperties(channel, {
		visible: {value: true, writable: true, configurable: true},
		canMessage: {value: true, writable: true, configurable: true},
		myhtml: {value: undefined, writable: true, configurable: true},
		guild: {value: guild, writable: true, configurable: true},
		localuser: {value: localuser, writable: true, configurable: true},
	});

	Object.assign(channel, {
		name: "general",
		owner: guild,
		isForum: () => false,
		isThread: () => false,
		member: undefined,
		nsfw: false,
		infinite: {
			delete: async () => {},
			getDiv: async () => document.createElement("div"),
			focus: async () => {},
		},
		rendertyping: () => {},
		makereplybox: () => {},
		getStoredDraft: () => undefined,
		collectBox: () => {},
		voiceMode: "VoiceOnly",
		setUpVoiceArea: async () => {},
		slowmode: async () => {},
	});

	return channel;
}

it("the refused first page re-asks once the cooldown passes", async () => {
	vi.useFakeTimers();
	const channel = refusedChannel();
	const cooldownMs = 30_000;
	Channel.historyCooldownUntil = Date.now() + cooldownMs;
	const putmessages = vi.spyOn(channel, "putmessages").mockResolvedValue(undefined);
	const buildmessages = vi.spyOn(channel, "buildmessages").mockResolvedValue(undefined);

	void channel.tryfocusinfinate();
	await vi.advanceTimersByTimeAsync(cooldownMs - 1);
	expect(putmessages).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(1);
	expect(putmessages).toHaveBeenCalledTimes(1);
	expect(buildmessages).toHaveBeenCalledTimes(1);
	// The skeleton comes down again only when a build actually lands; leave that to buildmessages.
});

it("a newer build's token bump cancels the pending re-ask", async () => {
	vi.useFakeTimers();
	const channel = refusedChannel();
	const putmessages = vi.spyOn(channel, "putmessages").mockResolvedValue(undefined);
	const buildmessages = vi.spyOn(channel, "buildmessages").mockResolvedValue(undefined);

	void channel.tryfocusinfinate();
	// getHTML's open of the same channel bumps the token instead of scheduling a re-ask.
	(channel as {beginFirstPageOpen: () => void}).beginFirstPageOpen();
	await vi.advanceTimersByTimeAsync(60_000);

	expect(putmessages).not.toHaveBeenCalled();
	expect(buildmessages).not.toHaveBeenCalled();
});

it("getHTML's build path starts a fresh first-page open", async () => {
	const channel = scaffoldedChannel();
	(channel as unknown as {firstPageRefusals?: number}).firstPageRefusals = 2;
	const begin = vi.spyOn(channel as {beginFirstPageOpen: () => void}, "beginFirstPageOpen");
	const putmessages = vi.spyOn(channel, "putmessages").mockResolvedValue(undefined);
	const buildmessages = vi.spyOn(channel, "buildmessages").mockResolvedValue(undefined);

	await channel.getHTML(false, true);

	expect(begin).toHaveBeenCalledTimes(1);
	expect(putmessages).toHaveBeenCalledTimes(1);
	expect(buildmessages).toHaveBeenCalledTimes(1);
	expect((channel as unknown as {firstPageRefusals?: number}).firstPageRefusals).toBe(0);
});

it("getHTML without a message fetch leaves the first-page state alone", async () => {
	const channel = scaffoldedChannel();
	(channel as unknown as {firstPageRefusals?: number}).firstPageRefusals = 2;
	const begin = vi.spyOn(channel as {beginFirstPageOpen: () => void}, "beginFirstPageOpen");
	await channel.getHTML(false, false);
	expect(begin).not.toHaveBeenCalled();
	expect((channel as unknown as {firstPageRefusals?: number}).firstPageRefusals).toBe(2);
});
