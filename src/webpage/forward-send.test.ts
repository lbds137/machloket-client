import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before other imports.
await import("./localuser");
const {captureRequests} = await import("./test/setup");
const {API, dmMessage, messageIn} = await import("./test/interactionFixture");
const {Message, sendForward, canSendToChannel, getChannelDisplayName} = await import("./message.js");
const {Dialog} = await import("./settings.js");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("forward send (context menu -> target picker -> POST)", () => {
	it("has a Forward button on the message context menu right after Reply, visible for normal messages", () => {
		const buttons = Message.contextmenu.buttons;
		const replyIndex = buttons.findIndex(
			(btn) => (btn as {icon?: {css?: string}}).icon?.css === "svg-reply",
		);
		const forwardIndex = buttons.findIndex(
			(btn) =>
				(btn as {icon?: {css?: string}}).icon?.css === "svg-forward" ||
				((btn as {text?: unknown}).text instanceof Function &&
					(btn as unknown as {text: () => string}).text() === I18n.message.forward()),
		);

		expect(forwardIndex).toBeGreaterThanOrEqual(0);
		expect(replyIndex).toBeGreaterThanOrEqual(0);
		expect(forwardIndex).toBe(replyIndex + 1);

		const forwardButton = buttons[forwardIndex] as unknown as {
			isVisible(m: unknown, arg: unknown): boolean;
		};

		// Normal type-0 message
		const {message: normalMessage} = messageIn("guild-1");
		normalMessage.type = 0;
		expect(forwardButton.isVisible(normalMessage, undefined)).toBe(true);

		// DM message
		const {message: dmMsg} = dmMessage();
		dmMsg.type = 0;
		expect(forwardButton.isVisible(dmMsg, undefined)).toBe(true);

		// Forward-of-a-forward (transitive forward, type 0) is also allowed client-side
		const {message: forwardOfForward} = messageIn("guild-1");
		forwardOfForward.type = 0;
		forwardOfForward.message_reference = {type: 1, message_id: "src-prev-1"};
		expect(forwardButton.isVisible(forwardOfForward, undefined)).toBe(true);

		// System messages, ephemerals and deferred placeholders are not forwardable
		const {message: joinMsg} = messageIn("guild-1");
		joinMsg.type = 7;
		expect(forwardButton.isVisible(joinMsg, undefined)).toBe(false);
		const {message: ephemeralMsg} = messageIn("guild-1");
		ephemeralMsg.type = 0;
		// ephemeral/loading are getter-only on the prototype: shadow them on the instance.
		Object.defineProperty(ephemeralMsg, "ephemeral", {value: true});
		expect(forwardButton.isVisible(ephemeralMsg, undefined)).toBe(false);
		const {message: loadingMsg} = messageIn("guild-1");
		loadingMsg.type = 0;
		Object.defineProperty(loadingMsg, "loading", {value: true});
		expect(forwardButton.isVisible(loadingMsg, undefined)).toBe(false);
	});

	it("issues POST to /channels/<target>/messages with exact forward reference payload", async () => {
		const {message} = messageIn("guild-1");
		(message as {id: string}).id = "source-message-123";
		const targetChannel = {id: "target-channel-456"};

		const sent = captureRequests(API + `/channels/${targetChannel.id}/messages`, () =>
			Response.json({id: "new-forwarded-msg"}),
		);

		await sendForward(message, targetChannel);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			content: "",
			message_reference: {
				type: 1,
				message_id: "source-message-123",
			},
		});

		// Same wire shape via the Message instance method
		const sentViaInstance = captureRequests(API + `/channels/${targetChannel.id}/messages`, () =>
			Response.json({id: "new-forwarded-msg-2"}),
		);
		await message.sendForward(targetChannel);
		expect(sentViaInstance).toEqual([
			{
				content: "",
				message_reference: {
					type: 1,
					message_id: "source-message-123",
				},
			},
		]);
	});

	it("surfaces refusal when the server responds with a non-OK status", async () => {
		const {message} = messageIn("guild-1");
		(message as {id: string}).id = "source-message-789";
		const targetChannel = {id: "target-channel-456"};

		captureRequests(API + `/channels/${targetChannel.id}/messages`, () =>
			new Response(null, {status: 403}),
		);

		const showSpy = vi.spyOn(Dialog.prototype, "show");
		const dio = {hide: vi.fn()};

		await sendForward(message, targetChannel, dio as never);

		expect(showSpy).toHaveBeenCalled();
		// The picker stays open for a retry.
		expect(dio.hide).not.toHaveBeenCalled();
	});

	it("surfaces refusal when network request fails (offline)", async () => {
		const {message} = messageIn("guild-1");
		(message as {id: string}).id = "source-message-offline";
		const targetChannel = {id: "target-channel-offline"};

		captureRequests(API + `/channels/${targetChannel.id}/messages`, () =>
			Promise.reject(new Error("offline")),
		);

		const showSpy = vi.spyOn(Dialog.prototype, "show");

		await sendForward(message, targetChannel);

		expect(showSpy).toHaveBeenCalled();
	});

	it("does not show refusal dialog on HTTP 200 OK", async () => {
		const {message} = messageIn("guild-1");
		(message as {id: string}).id = "source-message-ok";
		const targetChannel = {id: "target-channel-ok"};

		captureRequests(API + `/channels/${targetChannel.id}/messages`, () =>
			Response.json({id: "created-message-id"}),
		);

		const showSpy = vi.spyOn(Dialog.prototype, "show");
		const dio = {hide: vi.fn()};

		await sendForward(message, targetChannel, dio as never);

		expect(showSpy).not.toHaveBeenCalled();
		// A successful send closes the picker.
		expect(dio.hide).toHaveBeenCalled();
	});

	describe("candidate permissions and display labels", () => {
		it("always allows DM channels", () => {
			const dm = {
				id: "dm-1",
				guild_id: "@me",
				type: 1,
				users: [{name: "Alice"}],
			};
			expect(canSendToChannel(dm as never)).toBe(true);
			expect(getChannelDisplayName(dm as never)).toEqual({primary: "Alice"});
		});

		it("formats group DM channels by their name or participants", () => {
			const groupDm = {
				id: "gdm-1",
				guild_id: "@me",
				type: 3,
				name: "Cool Group",
			};
			expect(canSendToChannel(groupDm as never)).toBe(true);
			expect(getChannelDisplayName(groupDm as never)).toEqual({primary: "Cool Group"});
		});

		it("formats guild channels with #name and guild name as secondary", () => {
			const guildChannel = {
				id: "c-10",
				name: "announcements",
				guild: {id: "g-1", properties: {name: "My Server"}},
				hasPermission: () => true,
			};
			expect(getChannelDisplayName(guildChannel as never)).toEqual({
				primary: "#announcements",
				secondary: "My Server",
			});
		});

		it("excludes guild channels where user lacks SEND_MESSAGES", () => {
			const noSendChannel = {
				id: "c-locked",
				name: "locked-channel",
				type: 0,
				guild: {id: "g-1", member: {id: "u-1"}},
				visible: true,
				hasPermission: (perm: string) => perm !== "SEND_MESSAGES",
			};
			expect(canSendToChannel(noSendChannel as never)).toBe(false);
		});

		it("includes guild channels where user has SEND_MESSAGES", () => {
			const sendChannel = {
				id: "c-open",
				name: "open-channel",
				type: 0,
				guild: {id: "g-1", member: {id: "u-1"}},
				visible: true,
				hasPermission: (perm: string) => perm === "SEND_MESSAGES",
			};
			expect(canSendToChannel(sendChannel as never)).toBe(true);
		});

		it("includes guild channels when permission check is uncertain or unavailable", () => {
			const uncertainChannel = {
				id: "c-uncertain",
				name: "uncertain-channel",
				type: 0,
				guild: {id: "g-1", member: null},
			};
			expect(canSendToChannel(uncertainChannel as never)).toBe(true);
		});

		it("excludes hidden channels even when SEND_MESSAGES is granted", () => {
			const hiddenChannel = {
				id: "c-private",
				name: "private-channel",
				type: 0,
				guild: {id: "g-1", member: {id: "u-1"}},
				visible: false,
				hasPermission: (perm: string) => perm === "SEND_MESSAGES",
			};
			expect(canSendToChannel(hiddenChannel as never)).toBe(false);
		});

		it("excludes categories and forum channels", () => {
			const category = {
				id: "c-cat",
				type: 4,
				guild: {id: "g-1", member: {id: "u-1"}},
				visible: true,
				hasPermission: () => true,
			};
			const forum = {
				id: "c-forum",
				type: 15,
				guild: {id: "g-1", member: {id: "u-1"}},
				visible: true,
				hasPermission: () => true,
			};
			expect(canSendToChannel(category as never)).toBe(false);
			expect(canSendToChannel(forum as never)).toBe(false);
		});
	});
});
