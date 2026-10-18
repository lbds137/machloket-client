import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
const {retryAfterMs, retryAfterMsFromBody} = await import("./utils/rateLimit");
const {acceptInvite} = await import("./invite");
const {Message, fetchReactionUsers} = await import("./message");
const {Components} = await import("./interactions/compontents");
const {InteractionModal} = await import("./interactions/modal");
const {Command} = await import("./interactions/commands");

const API = "http://limit.test/api/v9";
const limited = () => Response.json({message: "rate limited", retry_after: 0.05}, {status: 429});

/** Answers the first call with `first`, then every later one with `rest`. */
function sequence(first: () => Response, rest: () => Response) {
	let calls = 0;
	return () => (calls++ === 0 ? first() : rest());
}

function channelAt(extra: object = {}) {
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: {id: "g1", info: {api: API}, unreads: () => {}},
		headers: {},
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
		message_notifications: 1,
		unreads: () => {},
		...extra,
	}) as InstanceType<typeof Channel>;
}

/** Message m1 in channel c1; `localuser` stands in for the session the message reads through. */
function messageAt(localuser: object = {favorites: {addReactEmoji: () => {}}}, extra: object = {}) {
	return Object.assign(Object.create(Message.prototype), {
		id: "m1",
		owner: {id: "c1", info: {api: API}, localuser},
		headers: {},
		reactions: [],
		...extra,
	}) as InstanceType<typeof Message>;
}

/** The session's interaction bookkeeping, registering as the real one does. */
function interactionSession() {
	return {
		interNonceMap: new Map<string, unknown>(),
		interactionNonces: new Set<string>(),
		registerInterNonce(nonce: string, message: unknown) {
			this.interNonceMap.set(nonce, message);
			this.interactionNonces.add(nonce);
		},
	};
}

/** A command with no options, owned by a guild-shaped stub whose owner is the session. */
function commandFor(localuser: object) {
	return new Command(
		{
			id: "cmd1",
			type: 1,
			application_id: "app1",
			name: "ping",
			description: "",
			dm_permission: true,
			version: "1",
			options: [],
		} as never,
		{info: {api: API}, headers: {}, owner: localuser} as never,
	);
}

afterEach(() => {
	vi.restoreAllMocks();
	Channel.historyCooldownUntil = 0;
});

describe("retryAfterMs", () => {
	it("reads the body's retry_after as seconds", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: 2}))).toBe(2000);
	});
	it("accepts a numeric string", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: "1.5"}))).toBe(1500);
	});
	it("defaults to 5 s when the body is missing or isn't JSON", () => {
		expect(retryAfterMs(429, null)).toBe(5000);
		expect(retryAfterMs(429, "<html>slow down</html>")).toBe(5000);
		expect(retryAfterMs(429, "{}")).toBe(5000);
	});
	it("caps the wait at 30 s", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: 600}))).toBe(30000);
	});
	it("is null for any status but 429", () => {
		expect(retryAfterMs(200, JSON.stringify({retry_after: 2}))).toBeNull();
		expect(retryAfterMs(500, null)).toBeNull();
	});
});

describe("retryAfterMsFromBody", () => {
	it("reads a numeric retry_after as seconds", () => {
		// PIN: the send path hands over its parsed XHR response, same contract as the text reader.
		expect(retryAfterMsFromBody({retry_after: 2})).toBe(2000);
	});
	it("accepts a numeric string", () => {
		// PIN: Spacebar may send the window as a string.
		expect(retryAfterMsFromBody({retry_after: "1.5"})).toBe(1500);
	});
	it("defaults to 5 s when the window is missing or the body is null", () => {
		// PIN: an unreadable 429 still waits.
		expect(retryAfterMsFromBody({})).toBe(5000);
		expect(retryAfterMsFromBody(null)).toBe(5000);
	});
	it("defaults to 5 s for a negative window", () => {
		// PIN: a negative window is unreadable, not a zero wait.
		expect(retryAfterMsFromBody({retry_after: -1})).toBe(5000);
	});
	it("defaults to 5 s for an empty-string window", () => {
		// PIN: "" is not 0 (Number("") is 0, which would retry at once).
		expect(retryAfterMsFromBody({retry_after: ""})).toBe(5000);
		expect(retryAfterMsFromBody({retry_after: "  "})).toBe(5000);
	});
	it("defaults to 5 s for a NaN window", () => {
		// PIN: NaN fails the >= 0 test, so it is unreadable, not a zero or NaN-ms wait.
		expect(retryAfterMsFromBody({retry_after: NaN})).toBe(5000);
		expect(retryAfterMsFromBody({retry_after: "soon"})).toBe(5000);
	});
	it("caps the wait at 30 s", () => {
		// PIN: one slow server can't park a send for minutes.
		expect(retryAfterMsFromBody({retry_after: 600})).toBe(30000);
	});
});

describe("the first history page of a channel", () => {
	it("a 429 isn't the channel's top, and arms the shared cooldown", async () => {
		captureRequests(API + "/channels/c1/messages", () =>
			Response.json({message: "rate limited", retry_after: 30}, {status: 429}),
		);
		const channel = channelAt();

		await channel.putmessages().catch(() => {});

		expect(channel.allthewayup).toBeFalsy();
		expect(Channel.historyCooldownUntil).toBeGreaterThan(Date.now());
	});

	it.each([
		["a server error", () => Response.json({message: "boom"}, {status: 500})],
		["a refusal", () => Response.json({code: 50001, message: "Missing Access"}, {status: 403})],
		["a proxy's error page", () => new Response("<html>bad gateway</html>", {status: 502})],
	])("%s isn't the channel's top either, and nothing throws", async (_, answer) => {
		captureRequests(API + "/channels/c1/messages", answer);
		const channel = channelAt();

		await expect(channel.putmessages()).resolves.toBeUndefined();

		expect(channel.allthewayup).toBeFalsy();
	});
});

describe("opening a channel whose first history page is rate-limited", () => {
	// Sessions opened by a test: leaving them at the end cancels any re-ask still pending, so it
	// can't fire into the next test.
	const opened: {channelfocus?: unknown}[] = [];
	afterEach(() => {
		for (const localuser of opened.splice(0)) localuser.channelfocus = {};
		document.body.innerHTML = "";
	});

	/** A channel opened as getHTML opens it (the skeleton up, putmessages then buildmessages),
	 * whose history endpoint answers `answers` in turn (the last one repeats). */
	async function openChannel(answers: (() => Response | Promise<Response>)[]) {
		await I18n.done;
		document.body.innerHTML = `<div id="loadingdiv" class="loading"></div><div id="scrollWrap"></div>`;
		let calls = 0;
		const asked = captureRequests(API + "/channels/c1/messages", () =>
			answers[Math.min(calls++, answers.length - 1)](),
		);
		const builtAround: string[] = [];
		const localuser: {channelfocus?: unknown} = {};
		// The channel's json says it has messages (last_message_id m9); no read state yet.
		const channel = channelAt({
			owner: {id: "@me", info: {api: API}, unreads: () => {}, localuser},
			lastmessageid: "m9",
			infinite: {
				getDiv: async (id: string) => {
					builtAround.push(id);
					return document.createElement("div");
				},
				snapBottom: () => () => {},
			},
			focus: async () => {},
			slowmode: async () => {},
		});
		localuser.channelfocus = channel;
		await channel.putmessages();
		await channel.buildmessages();
		opened.push(localuser);
		return {channel, localuser, asked, builtAround};
	}
	const page = () => Response.json([{id: "9", author: {}}]);
	const loading = () => document.getElementById("loadingdiv")!.classList.contains("loading");

	it("doesn't call it empty, and keeps the skeleton up", async () => {
		await openChannel([limited, page]);

		// The user must not be told that a channel with messages is empty.
		expect(document.getElementById("removetitle")?.textContent).not.toBe(I18n.noMessages());
		expect(loading()).toBe(true);
	});

	it("asks again by itself once the window passes, and builds the page", async () => {
		const {asked, builtAround} = await openChannel([limited, page]);

		await vi.waitFor(() => expect(builtAround).toEqual(["9"]), {timeout: 1000});
		expect(asked).toHaveLength(2);
		expect(loading()).toBe(false);
	});

	it("a switch to another channel cancels the re-ask", async () => {
		const {localuser, asked} = await openChannel([limited, page]);
		localuser.channelfocus = {};

		await new Promise((r) => setTimeout(r, 200)); // well past the 0.05 s window

		expect(asked).toHaveLength(1);
	});

	it("a channel opened while the re-ask's fetch is in flight is left alone", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const {localuser, asked, builtAround} = await openChannel([
			limited,
			() => gate.then(page),
		]);
		await vi.waitFor(() => expect(asked).toHaveLength(2), {timeout: 1000});
		// The user opens channel B: its getHTML bumps the generation and fills the scroller.
		const theirs = document.createElement("div");
		theirs.classList.add("messagecontainer");
		document.getElementById("scrollWrap")!.append(theirs);
		localuser.channelfocus = {};
		const genid = ++Channel.genid;

		release();
		await new Promise((r) => setTimeout(r, 100));

		expect(Channel.genid).toBe(genid);
		expect(theirs.isConnected).toBe(true);
		expect(builtAround).toEqual([]);
	});

	it("opening the channel again supersedes the pending re-ask", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const {channel, localuser, asked} = await openChannel([
			() => Response.json({retry_after: 0.15}, {status: 429}),
			() => gate.then(page),
		]);
		// The user switches away and back: getHTML's build path runs again, and its own
		// putmessages (held here) is the ask that counts.
		localuser.channelfocus = {};
		localuser.channelfocus = channel;
		Channel.genid++;
		channel.beginFirstPageOpen();
		const reopened = channel.putmessages();

		await new Promise((r) => setTimeout(r, 300)); // past the old re-ask's window
		release();
		await reopened;

		// The first ask and the reopen's own: the old re-ask sent none of its own.
		expect(asked).toHaveLength(2);
	});

	it("re-clicking the channel in view doesn't cancel the re-ask", async () => {
		const {asked, builtAround} = await openChannel([limited, page]);
		// getHTML's early return for the channel already in view bumps the generation.
		Channel.genid++;

		await new Promise((r) => setTimeout(r, 200)); // well past the 0.05 s window

		expect(asked).toHaveLength(2);
		expect(builtAround).toEqual(["9"]);
	});

	it("three refusals end in a failed load, not an empty channel", async () => {
		const {asked, builtAround} = await openChannel([limited]);

		await vi.waitFor(() => expect(asked).toHaveLength(3), {timeout: 1000});
		await vi.waitFor(() => expect(loading()).toBe(false), {timeout: 1000});
		await new Promise((r) => setTimeout(r, 200)); // a 4th ask would have come by now

		expect(asked).toHaveLength(3);
		expect(builtAround).toEqual([]);
		expect(document.getElementById("removetitle")).toBeNull();
	});
});

describe("an attachment upload slot", () => {
	const slot = () =>
		Response.json({
			attachments: [{id: "0", upload_url: "http://limit.test/put", upload_filename: "up/x"}],
		});
	const file = new File(["hi"], "x.txt");

	it("a 429 waits its window, asks again once, and the upload lands", async () => {
		const asked = captureRequests(API + "/channels/c1/attachments", sequence(limited, slot));
		captureRequests("http://limit.test/put", () => new Response(null, {status: 200}));

		const got = await channelAt().uploadFile([file]);

		expect(asked).toHaveLength(2);
		expect(got[0].upload_filename).toBe("up/x");
	});

	it("a second 429 throws an error that names the status", async () => {
		const asked = captureRequests(API + "/channels/c1/attachments", limited);

		await expect(channelAt().uploadFile([file])).rejects.toThrow(/429/);
		expect(asked).toHaveLength(2);
	});
});

describe("an attachment upload's byte stream (the PUT)", () => {
	const slot = () =>
		Response.json({
			attachments: [{id: "0", upload_url: "http://limit.test/put", upload_filename: "up/x"}],
		});
	const file = new File(["hi"], "x.txt");

	// RED: at HEAD the 429 PUT is final, so uploadFile rejects with "attachment upload failed: 429".
	it("a 429 waits its window, puts again once, and the upload lands", async () => {
		const slots = captureRequests(API + "/channels/c1/attachments", slot);
		const puts = captureRequests("http://limit.test/put", sequence(limited, () => new Response(null, {status: 200})));

		const got = await channelAt().uploadFile([file]);

		expect(puts).toHaveLength(2);
		expect(slots).toHaveLength(1);
		expect(got[0].upload_filename).toBe("up/x");
	});

	// RED: at HEAD the PUT is asked once (the rejection already matches; the count is what fails).
	it("a second 429 throws an error that names the status", async () => {
		captureRequests(API + "/channels/c1/attachments", slot);
		const puts = captureRequests("http://limit.test/put", limited);

		await expect(channelAt().uploadFile([file])).rejects.toThrow(/attachment upload failed: 429/);
		expect(puts).toHaveLength(2);
	});
});

describe("accepting an invite", () => {
	it("a 429 waits its window and asks again once", async () => {
		const asked = captureRequests(API + "/invites/abc", sequence(limited, () => Response.json({})));

		const result = await acceptInvite(API, "abc", "tok");

		expect(asked).toHaveLength(2);
		expect(result.ok).toBe(true);
	});

	it("a second 429 isn't a join", async () => {
		captureRequests(API + "/invites/abc", limited);

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.ok).toBe(false);
	});
});

describe("a notification-settings PATCH", () => {
	it("a 429 waits its window and asks again once", async () => {
		const sent = captureRequests(
			API + "/users/@me/guilds/g1/settings",
			sequence(limited, () => Response.json({})),
		);

		channelAt().unmuteChannel();

		await vi.waitFor(() => expect(sent).toHaveLength(2), {timeout: 1500});
	});
});

describe("a newer settings PATCH", () => {
	afterEach(() => {
		document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
	});

	it("an unmute during a mute's 429 window cancels the mute's retry", async () => {
		await I18n.done;
		let calls = 0;
		const sent = captureRequests(API + "/users/@me/guilds/g1/settings", () =>
			calls++ === 0
				? Response.json({message: "rate limited", retry_after: 0.3}, {status: 429})
				: Response.json({}),
		);
		const channel = channelAt({showMuteState: () => {}});

		// Mute for 30m through the real dialog: its submit button sends the PATCH.
		channel.muteChannel();
		[...document.querySelectorAll("button")]
			.find((b) => b.textContent === I18n.submit())!
			.click();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		// The user changes their mind while the mute waits out its window.
		channel.unmuteChannel();
		await vi.waitFor(() => expect(sent).toHaveLength(2));

		await new Promise((r) => setTimeout(r, 500)); // past the mute's window

		// The newest PATCH (the unmute) must be the last thing the server hears.
		const last = sent.at(-1) as {channel_overrides: {c1: {muted: boolean}}};
		expect(last.channel_overrides.c1.muted).toBe(false);
		expect(sent).toHaveLength(2);
	});

	it("a status change during an older status's 429 window cancels the older retry", async () => {
		await I18n.done;
		let calls = 0;
		const sent = captureRequests(API + "/users/@me/settings", () =>
			calls++ === 0
				? Response.json({message: "rate limited", retry_after: 0.3}, {status: 429})
				: Response.json({}),
		);
		const user = {
			info: {api: API},
			headers: {},
			status: "online",
			user: {setstatus: () => {}},
		} as unknown as InstanceType<typeof Localuser>;
		Localuser.openStatusDialog(user);
		const select = document.querySelector("select")!;
		const pick = (index: number) => {
			select.selectedIndex = index;
			select.dispatchEvent(new Event("change"));
		};
		// The select's options are online, invisible, dnd, idle.
		pick(3);
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		pick(2);
		await vi.waitFor(() => expect(sent).toHaveLength(2));

		await new Promise((r) => setTimeout(r, 500)); // past the idle's window

		expect((sent.at(-1) as {status: string}).status).toBe("dnd");
		expect(sent).toHaveLength(2);
	});

	it("a folder save during an older save's 429 window cancels the older retry", async () => {
		let calls = 0;
		const sent = captureRequests(API + "/users/@me/settings", () =>
			calls++ === 0
				? Response.json({message: "rate limited", retry_after: 0.3}, {status: 429})
				: Response.json({}),
		);
		const folder = (name: string) => ({id: 1, name, color: 0, guilds: [{id: "g1"}]});
		const user = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {},
			guildOrder: [folder("old")],
		}) as InstanceType<typeof Localuser>;

		const older = user.saveGuildOrder();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		user.guildOrder = [folder("new")] as never;
		const newer = user.saveGuildOrder();
		await Promise.all([older, newer]);

		await new Promise((r) => setTimeout(r, 500)); // past the older save's window
		const names = sent.map((b) => (b as {guild_folders: {name: string}[]}).guild_folders[0].name);
		expect(names).toEqual(["old", "new"]);
	});
});

describe("a reaction toggle", () => {
	it("a 429 waits its window and asks again once", async () => {
		// reactionToggle encodes a unicode emoji into the path: 🔥 is %F0%9F%94%A5.
		const sent = captureRequests(
			API + "/channels/c1/messages/m1/reactions/%F0%9F%94%A5/@me",
			sequence(limited, () => new Response(null, {status: 204})),
		);

		messageAt().reactionToggle("🔥");

		await vi.waitFor(() => expect(sent).toHaveLength(2), {timeout: 1500});
	});
});

describe("a message edit", () => {
	it("a 429 waits its window, asks again once, and the edit lands", async () => {
		const asked = captureRequests(
			API + "/channels/c1/messages/m1",
			sequence(limited, () => Response.json({})),
		);
		const message = messageAt(undefined, {content: {textContent: "old", rawString: "old"}});

		const res = await message.edit("new");

		expect(asked).toHaveLength(2);
		expect(res?.ok).toBe(true);
	});
});

describe("a stale edit", () => {
	/** Answers each call with the next of `answers`, and with a 200 once they run out. */
	function inTurn(...answers: (() => Response)[]) {
		return () => (answers.shift() ?? (() => Response.json({})))();
	}
	const limitedFor = (seconds: number) =>
		Response.json({message: "rate limited", retry_after: seconds}, {status: 429});

	it("a newer edit cancels an older one's retry, and the newer text lands", async () => {
		const asked = captureRequests(
			API + "/channels/c1/messages/m1",
			inTurn(
				() => limitedFor(0.5),
				() => limitedFor(0.02),
				() => Response.json({}),
			),
		);
		const message = messageAt(undefined, {content: {textContent: "old", rawString: "old"}});

		const [a, b] = await Promise.all([message.edit("A"), message.edit("B")]);

		expect(asked).toHaveLength(3);
		expect(asked[2]).toEqual({content: "B"});
		expect(a?.status).toBe(429);
		expect(b?.ok).toBe(true);
	});

	it("an edit made during an older one's window cancels its retry", async () => {
		const asked = captureRequests(
			API + "/channels/c1/messages/m1",
			inTurn(
				() => limitedFor(0.3),
				() => Response.json({}),
			),
		);
		const message = messageAt(undefined, {content: {textContent: "old", rawString: "old"}});

		const a = message.edit("A");
		// A is waiting out its window.
		await new Promise((r) => setTimeout(r, 100));
		const b = await message.edit("B");

		expect((await a)?.status).toBe(429);
		expect(asked).toHaveLength(2);
		expect(asked[1]).toEqual({content: "B"});
		expect(b?.ok).toBe(true);
	});
});

describe("an edit reverted during an older edit's window", () => {
	it("cancels the older edit's retry", async () => {
		const asked = captureRequests(
			API + "/channels/c1/messages/m1",
			sequence(
				() => Response.json({message: "rate limited", retry_after: 0.3}, {status: 429}),
				() => Response.json({}),
			),
		);
		const message = messageAt(undefined, {content: {textContent: "old", rawString: "old"}});

		const a = message.edit("A");
		await new Promise((r) => setTimeout(r, 100)); // A is waiting out its window
		// The user reverts: the newest intent is the current text.
		await message.edit("old");
		await a;

		expect(asked.filter((b) => (b as {content?: string}).content === "A")).toHaveLength(1);
	});
});

describe("a component click", () => {
	/** A real component (an unknown type renders as an error element) on message m1. */
	function componentOn(message: InstanceType<typeof Message>) {
		return new Components([{type: 999}] as never, message).components[0] as unknown as {
			postInteraction(nonce: string, body: object): Promise<void>;
		};
	}

	it("a 429 waits its window, asks again once, and isn't a failure", async () => {
		const asked = captureRequests(API + "/interactions", sequence(limited, () => Response.json({})));
		const session = interactionSession();
		const interactionEvents = vi.fn();
		const message = messageAt(session, {interactionEvents});

		await componentOn(message).postInteraction("n1", {type: 3});

		expect(asked).toHaveLength(2);
		expect(interactionEvents).not.toHaveBeenCalled();
		expect(session.interNonceMap.has("n1")).toBe(true);
		expect(session.interactionNonces.has("n1")).toBe(true);
	});

	it("a second 429 shows as a failed interaction", async () => {
		const asked = captureRequests(API + "/interactions", limited);
		const session = interactionSession();
		const interactionEvents = vi.fn();
		const message = messageAt(session, {interactionEvents});

		await componentOn(message).postInteraction("n1", {type: 3});

		expect(asked).toHaveLength(2);
		expect(interactionEvents).toHaveBeenCalledOnce();
		expect(interactionEvents.mock.calls[0][0]).toMatchObject({
			t: "INTERACTION_FAILURE",
			d: {nonce: "n1", reason_code: 0},
		});
		expect(session.interNonceMap.has("n1")).toBe(false);
	});
});

describe("a modal submit", () => {
	it("a 429 waits its window, asks again once, and the modal closes", async () => {
		const asked = captureRequests(API + "/interactions", sequence(limited, () => Response.json({})));
		const forgetSubmit = vi.fn();
		const modal = new InteractionModal(
			{
				id: "i1",
				channel_id: "c1",
				custom_id: "form",
				title: "Form",
				components: [],
				application: {id: "app1", name: "Bot"},
			},
			{api: API, headers: {}, forgetSubmit},
		);
		const close = vi.spyOn(modal, "close");

		const accepted = await modal.submit();

		expect(asked).toHaveLength(2);
		expect(accepted).toBe(true);
		expect(forgetSubmit).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
	});
});

describe("a context-menu command", () => {
	const dm = {id: "c1", owner: {id: "@me"}} as never;

	it("a 429 waits its window, asks again once, and the command is sent", async () => {
		const asked = captureRequests(API + "/interactions", sequence(limited, () => Response.json({})));
		const forgetCommandNonce = vi.fn();
		const command = commandFor({registerCommandNonce: () => {}, forgetCommandNonce});

		const sent = await command.submitContext("u1", dm, document.createElement("div"));

		expect(asked).toHaveLength(2);
		expect(sent).toBe(true);
		expect(forgetCommandNonce).not.toHaveBeenCalled();
	});

	it("a second 429 isn't sent, and its nonce is forgotten", async () => {
		const asked = captureRequests(API + "/interactions", limited);
		const forgetCommandNonce = vi.fn();
		const command = commandFor({registerCommandNonce: () => {}, forgetCommandNonce});

		const sent = await command.submitContext("u1", dm, document.createElement("div"));

		expect(asked).toHaveLength(2);
		expect(sent).toBe(false);
		expect(forgetCommandNonce).toHaveBeenCalledOnce();
	});
});

describe("a slash command", () => {
	const dm = {id: "c1", owner: {id: "@me"}} as never;

	it("a 429 waits its window, asks again once, and the command is sent", async () => {
		const asked = captureRequests(API + "/interactions", sequence(limited, () => Response.json({})));
		const forgetCommandNonce = vi.fn();
		const command = commandFor({registerCommandNonce: () => {}, forgetCommandNonce});
		// What the composer collected for a command with no options.
		command.state.set(dm, []);

		const sent = await command.submit(document.createElement("div"), dm);

		expect(asked).toHaveLength(2);
		expect(sent).toBe(true);
		expect(forgetCommandNonce).not.toHaveBeenCalled();
	});

	it("a second 429 isn't sent, and its nonce is forgotten", async () => {
		const asked = captureRequests(API + "/interactions", limited);
		const forgetCommandNonce = vi.fn();
		const command = commandFor({registerCommandNonce: () => {}, forgetCommandNonce});
		command.state.set(dm, []);

		const sent = await command.submit(document.createElement("div"), dm);

		expect(asked).toHaveLength(2);
		expect(sent).toBe(false);
		expect(forgetCommandNonce).toHaveBeenCalledOnce();
	});
});

describe("pinning a message", () => {
	it("a 429 waits its window, asks again once, and the pin lands quietly", async () => {
		const asked = captureRequests(
			API + "/channels/c1/pins/m1",
			sequence(limited, () => new Response(null, {status: 204})),
		);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

		await messageAt().setPinned(true);

		expect(asked).toHaveLength(2);
		expect(alert).not.toHaveBeenCalled();
	});

	it("a second 429 says the pin failed", async () => {
		// The alert's text comes from the translations, which load at import.
		const {I18n} = await import("./i18n");
		await I18n.done;
		const asked = captureRequests(API + "/channels/c1/pins/m1", limited);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

		await messageAt().setPinned(true);

		expect(asked).toHaveLength(2);
		expect(alert).toHaveBeenCalledOnce();
	});

	it("unpinning: a 429 waits its window, asks again once, and the unpin lands quietly", async () => {
		const asked = captureRequests(
			API + "/channels/c1/pins/m1",
			sequence(limited, () => new Response(null, {status: 204})),
		);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});

		await messageAt().setPinned(false);

		expect(asked).toHaveLength(2);
		expect(alert).not.toHaveBeenCalled();
	});
});

describe("the pins panel", () => {
	const pins = () => Response.json([{id: "m1"}]);

	it("a 429 waits its window, asks again once, and the pins arrive", async () => {
		const asked = captureRequests(API + "/channels/c1/pins", sequence(limited, pins));

		const got = await channelAt().fetchPinnedMessages();

		expect(asked).toHaveLength(2);
		expect(got).toEqual([{id: "m1"}]);
	});

	it("a second 429 is a failure that names the status", async () => {
		const asked = captureRequests(API + "/channels/c1/pins", limited);

		await expect(channelAt().fetchPinnedMessages()).rejects.toThrow(/429/);
		expect(asked).toHaveLength(2);
	});
});

describe("a reaction-user list", () => {
	const reactors = () => Response.json([{id: "u1", username: "ana"}]);

	it("a 429 waits its window, asks again once, and the users arrive", async () => {
		const asked = captureRequests(
			API + "/channels/c1/messages/m1/reactions/%F0%9F%94%A5",
			sequence(limited, reactors),
		);

		const users = await fetchReactionUsers(messageAt(), {name: "🔥"}, 3);

		expect(asked).toHaveLength(2);
		expect(users).toEqual([{id: "u1", username: "ana"}]);
	});

	it("a second 429 is nobody", async () => {
		const asked = captureRequests(API + "/channels/c1/messages/m1/reactions/%F0%9F%94%A5", limited);

		const users = await fetchReactionUsers(messageAt(), {name: "🔥"}, 3);

		expect(asked).toHaveLength(2);
		expect(users).toEqual([]);
	});

	it("the hover preview asks once: a 429 is nobody, with no retry", async () => {
		const asked = captureRequests(API + "/channels/c1/messages/m1/reactions/%F0%9F%94%A5", limited);

		const users = await fetchReactionUsers(messageAt(), {name: "🔥"}, 3, {retry: false});

		expect(asked).toHaveLength(1);
		expect(users).toEqual([]);
	});
});

describe("the reactions popup", () => {
	it("a 429 wait that outlasts a click on another reaction keeps its list without showing it", async () => {
		// The dialog's title comes from the translations, which load at import.
		const {I18n} = await import("./i18n");
		await I18n.done;
		// 🔥 is %F0%9F%94%A5, 🙂 is %F0%9F%99%82.
		const askedFire = captureRequests(
			API + "/channels/c1/messages/m1/reactions/%F0%9F%94%A5",
			sequence(
				() => Response.json({message: "rate limited", retry_after: 0.5}, {status: 429}),
				() => Response.json([{id: "u1"}, {id: "u2"}]),
			),
		);
		const askedSmile = captureRequests(
			API + "/channels/c1/messages/m1/reactions/%F0%9F%99%82",
			() => Response.json([{id: "u3"}]),
		);
		// Users the session already knows: User's constructor hands back the cached one.
		const known = (id: string) => ({
			userupdate: vi.fn(),
			createWidget: () => Object.assign(document.createElement("div"), {textContent: id}),
		});
		const userMap = new Map(["u1", "u2", "u3"].map((id) => [id, known(id)]));
		const message = messageAt(
			{userMap},
			{
				reactions: [
					{count: 2, emoji: {name: "🔥"}, me: false},
					{count: 1, emoji: {name: "🙂"}, me: false},
				],
			},
		);

		// Opening the popup clicks the first reaction, 🔥.
		message.viewReactions();
		const list = [...document.querySelectorAll<HTMLElement>(".reactionUserList")].at(-1)!;
		const [fire, smile] = [...list.previousElementSibling!.children] as HTMLElement[];
		const shown = () => [...list.children].map((widget) => widget.textContent);
		const click = (button: HTMLElement) =>
			button.onclick!.call(button, new PointerEvent("click"));

		await vi.waitFor(() => expect(askedFire).toHaveLength(1));
		await click(smile);
		expect(askedSmile).toHaveLength(1);
		expect(shown()).toEqual(["u3"]);

		// 🔥's retry lands; its users are built, then the guard skips the render.
		await vi.waitFor(() => expect(userMap.get("u2")!.userupdate).toHaveBeenCalled(), {
			timeout: 1500,
		});
		expect(shown()).toEqual(["u3"]);

		await click(fire);
		expect(askedFire).toHaveLength(2);
		expect(shown()).toEqual(["u1", "u2"]);

		list.closest("body > *")!.remove();
	});
});

describe("a read ack", () => {
	it("whose 429 window outlives a newer ack isn't sent again", async () => {
		const acked: string[] = [];
		let first = true;
		for (const id of ["m5", "m9"]) {
			captureRequests(API + `/channels/c1/messages/${id}/ack`, () => {
				acked.push(id);
				if (first) {
					first = false;
					return Response.json({message: "rate limited", retry_after: 0.3}, {status: 429});
				}
				return new Response(null, {status: 204});
			});
		}
		const channel = channelAt({
			unreadState: () => true,
			owner: {id: "g1", info: {api: API}, unreads: () => {}, localuser: {}},
			infinite: {toBottom: () => {}},
		}) as InstanceType<typeof Channel> & {trueLastMessageid: string};

		channel.trueLastMessageid = "m5";
		channel.readbottom();
		await vi.waitFor(() => expect(acked).toEqual(["m5"]));
		// The user reads on: a newer ack goes out while m5's retry waits.
		channel.trueLastMessageid = "m9";
		channel.readbottom();
		await new Promise((r) => setTimeout(r, 500)); // past m5's window

		// The server's read state only moves where it's told: m5 again would move it back.
		expect(acked).toEqual(["m5", "m9"]);
	});
});
