import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before other imports.
await import("./localuser");
const {Message} = await import("./message.js");
const {dmMessage} = await import("./test/interactionFixture");
const {I18n} = await import("./i18n");
await I18n.done;

describe("received forwarded messages (message_snapshots)", () => {
	/** Header-render stubs: the real User methods would fetch avatars/members
	 * (same approach as scrollAnchor.test.ts's authorOf). checkuser returns these
	 * from userMap instead of building real Users. */
	function stubAuthor(id: string, username: string) {
		return {
			id,
			username,
			name: username,
			relationshipType: 0,
			buildpfp: () => document.createElement("div"),
			bind: () => {},
			subName: () => {},
			getpfpsrc: () => "",
			getCustomBadges: async () => [],
			userupdate: () => {},
			members: new Map(),
		};
	}
	function setupTestChannel() {
		const {channel, localuser} = dmMessage();
		(channel as any).name = "general";
		(channel as any).infinite = {snapBottom: () => () => {}, focus: () => {}};
		(channel as any).messages = new Map();
		(channel as any).idToPrev = new Map();
		(channel as any).idToNext = new Map();
		(channel as any).getmessage = async () => null;
		(channel as any).focus = () => {};
		(channel.info as any).cdn = "http://dm.test/cdn";
		const me = stubAuthor("me", "Me");
		const authors = [me, stubAuthor("author-1", "Forwarder"), stubAuthor("author-2", "Replier")];
		(localuser as any).user = me;
		(localuser as any).userMap = new Map(authors.map((u) => [u.id, u]));
		(localuser as any).refreshURL = async (u: string) => u;
		(localuser as any).favorites = {hasGif: () => false, emojiReactFreq: () => []};
		localuser.channelids.set(channel.id, channel as never);
		(channel.guild as any).roleids = new Map();
		(channel.guild as any).member = null;
		(channel.guild as any).properties = {name: "Test Guild"};
		(channel.guild as any).cachedContextCommands = () => [];
		(channel.guild as any).goToThread = () => {};
		(channel as any).hasPermission = () => false;
		(channel as any).lastmessageid = "0";
		return {channel, localuser};
	}

	const txtFile = {
		id: "file-1",
		filename: "forwarded-file.txt",
		content_type: "text/plain",
		url: "http://dm.test/cdn/forwarded-file.txt",
		size: 123,
	};
	const embed = {type: "rich", title: "Snapshot Embed", description: "Snapshot embed description"};

	/** A forward-shaped message on the wire: type 0, reference type 1, content in the snapshot. */
	function forwardJson(channel: unknown, overrides: Record<string, unknown> = {}) {
		const id = (channel as {id: string}).id;
		return {
			id: "msg-forward-1",
			type: 0,
			content: "",
			timestamp: "2026-10-16T12:00:00+00:00",
			edited_timestamp: null,
			author: {id: "author-1", username: "Forwarder"},
			attachments: [],
			embeds: [],
			stickers: [],
			reactions: [],
			flags: 0,
			pinned: false,
			tts: false,
			mention_everyone: false,
			mentions: [],
			channel_id: id,
			guild_id: "@me",
			message_reference: {message_id: "1000000000000001", channel_id: id, type: 1},
			message_snapshots: [
				{
					message: {
						content: "forwarded hello",
						type: 0,
						timestamp: "2026-10-16T12:00:00+00:00",
						attachments: [txtFile],
						embeds: [embed],
					},
				},
			],
			...overrides,
		};
	}

	function render(json: unknown, channel: unknown) {
		const m = new Message(json as never, channel as never);
		const div = document.createElement("div");
		m.div = div;
		m.generateMessage(undefined, false, div);
		return {m, div};
	}

	it("renders a forward block with snapshot content, attachment, and embed, without replytext", () => {
		const {channel} = setupTestChannel();
		const {div} = render(forwardJson(channel), channel);

		// Assert no reply line renders
		expect(div.querySelector(".replytext")).toBeNull();

		// Assert forward block exists and contains the text "forwarded hello"
		const forwardBlock = div.querySelector(".forwardBlock");
		expect(forwardBlock).not.toBeNull();
		expect(forwardBlock!.textContent).toContain("forwarded hello");

		// Assert attachment filename appears inside the block
		expect(forwardBlock!.textContent).toContain("forwarded-file.txt");

		// Assert embed renders inside the block
		expect(forwardBlock!.querySelector(".embed")).not.toBeNull();
	});

	it("a normal reply (reference type 0 + referenced_message) still renders a replytext element", () => {
		const {channel} = setupTestChannel();

		const replyJson = {
			id: "msg-reply-1",
			type: 0,
			content: "reply text",
			timestamp: "2026-10-16T12:00:00+00:00",
			edited_timestamp: null,
			author: {id: "author-2", username: "Replier"},
			attachments: [],
			embeds: [],
			stickers: [],
			reactions: [],
			flags: 0,
			pinned: false,
			tts: false,
			mention_everyone: false,
			mentions: [],
			channel_id: channel.id,
			guild_id: "@me",
			message_reference: {
				message_id: "1000000000000001",
				channel_id: channel.id,
				type: 0,
			},
			referenced_message: {
				id: "1000000000000001",
				content: "original message",
				author: {id: "author-1", username: "Original"},
				channel_id: channel.id,
				guild_id: "@me",
				type: 0,
				timestamp: "2026-10-16T11:00:00+00:00",
				edited_timestamp: null,
				attachments: [],
				embeds: [],
				stickers: [],
				reactions: [],
				flags: 0,
				pinned: false,
				tts: false,
				mention_everyone: false,
				mentions: [],
			},
		};

		const replyMessage = new Message(replyJson as never, channel as never);
		const div = document.createElement("div");
		replyMessage.generateMessage(undefined, false, div);

		// Control assertion: normal reply still renders replytext
		expect(div.querySelector(".replytext")).not.toBeNull();
	});

	it("suppresses the Edit context menu button for forwards", () => {
		const {channel} = setupTestChannel();

		const forwardMessage = new Message(
			forwardJson(channel, {id: "msg-forward-2", author: {id: "me", username: "Me"}}) as never,
			channel as never,
		);
		const editButton = Message.contextmenu.buttons.find(
			(opt) => (opt as {icon?: {css?: string}}).icon?.css === "svg-edit",
		) as unknown as {isVisible(m: unknown, arg: unknown): boolean};
		expect(editButton).toBeDefined();
		expect(editButton.isVisible(forwardMessage, undefined)).toBe(false);

		// Control: message authored by me without forward reference can be edited
		const normalMessage = new Message(
			forwardJson(channel, {
				id: "msg-normal-mine",
				author: {id: "me", username: "Me"},
				message_reference: undefined,
				message_snapshots: undefined,
			}) as never,
			channel as never,
		);
		expect(editButton.isVisible(normalMessage, undefined)).toBe(true);
	});

	it("suppresses the hover edit button for forwards but keeps it for own normal messages", () => {
		const {channel} = setupTestChannel();

		const fwd = render(
			forwardJson(channel, {id: "fw-hover", author: {id: "me", username: "Me"}}),
			channel,
		);
		fwd.m.bindButtonEvent();
		fwd.div.dispatchEvent(new Event("mouseenter"));
		expect(fwd.div.querySelector(".messageButtons")).not.toBeNull();
		expect(fwd.div.querySelector(".messageButtons .svg-edit")).toBeNull();

		const normal = render(
			forwardJson(channel, {
				id: "nm-hover",
				author: {id: "me", username: "Me"},
				message_reference: undefined,
				message_snapshots: undefined,
			}),
			channel,
		);
		normal.m.bindButtonEvent();
		normal.div.dispatchEvent(new Event("mouseenter"));
		expect(normal.div.querySelector(".messageButtons .svg-edit")).not.toBeNull();
	});

	it("offers no hover edit button on the user's own system lines (a pin, a join)", () => {
		const {channel} = setupTestChannel();

		const pin = render(
			forwardJson(channel, {
				id: "pin-hover",
				type: 6,
				author: {id: "me", username: "Me"},
				message_reference: undefined,
				message_snapshots: undefined,
			}),
			channel,
		);
		pin.m.bindButtonEvent();
		pin.div.dispatchEvent(new Event("mouseenter"));

		expect(pin.div.querySelector(".messageButtons")).not.toBeNull();
		expect(pin.div.querySelector(".messageButtons .svg-edit")).toBeNull();
	});

	it("edit-last skips forwards but still edits own normal messages", async () => {
		const {Channel} = await import("./channel");
		const {channel} = setupTestChannel();
		const fwd = new Message(
			forwardJson(channel, {id: "fw-last", author: {id: "me", username: "Me"}}) as never,
			channel as never,
		);
		const fwdEdit = vi.spyOn(fwd, "setEdit").mockImplementation(() => {});
		const normal = new Message(
			forwardJson(channel, {
				id: "nm-last",
				author: {id: "me", username: "Me"},
				message_reference: undefined,
				message_snapshots: undefined,
			}) as never,
			channel as never,
		);
		const normalEdit = vi.spyOn(normal, "setEdit").mockImplementation(() => {});
		const editLast = (Channel.prototype as unknown as {editLast: () => void}).editLast;
		const fakeChannel = {
			lastmessage: fwd,
			messages: new Map([
				["fw-last", fwd],
				["nm-last", normal],
			]),
			idToPrev: new Map([
				["fw-last", "nm-last"],
				["nm-last", "0"],
			]),
			localuser: {user: fwd.author},
		};
		editLast.call(fakeChannel);
		expect(fwdEdit).not.toHaveBeenCalled();
		expect(normalEdit).toHaveBeenCalled();
	});

	it("edit-last skips the user's own system lines (a pin) for their last real message", async () => {
		const {Channel} = await import("./channel");
		const {channel} = setupTestChannel();
		const own = {
			author: {id: "me", username: "Me"},
			message_reference: undefined,
			message_snapshots: undefined,
		};
		const pin = new Message(
			forwardJson(channel, {id: "pin-last", type: 6, ...own}) as never,
			channel as never,
		);
		const pinEdit = vi.spyOn(pin, "setEdit").mockImplementation(() => {});
		const normal = new Message(
			forwardJson(channel, {id: "nm-before", ...own}) as never,
			channel as never,
		);
		const normalEdit = vi.spyOn(normal, "setEdit").mockImplementation(() => {});
		const editLast = (Channel.prototype as unknown as {editLast: () => void}).editLast;

		editLast.call({
			lastmessage: pin,
			messages: new Map([
				["pin-last", pin],
				["nm-before", normal],
			]),
			idToPrev: new Map([
				["pin-last", "nm-before"],
				["nm-before", "0"],
			]),
			localuser: {user: pin.author},
		});

		expect(pinEdit).not.toHaveBeenCalled();
		expect(normalEdit).toHaveBeenCalled();
	});

	it("a create event's referenced_message stays out of the render and the source channel's history", () => {
		const {channel} = setupTestChannel();
		const {div} = render(
			forwardJson(channel, {
				referenced_message: {
					id: "1000000000000001",
					content: "original secret",
					author: {id: "author-2", username: "Replier"},
					channel_id: channel.id,
					guild_id: "@me",
					type: 0,
					timestamp: "2026-10-16T11:00:00+00:00",
					edited_timestamp: null,
					attachments: [],
					embeds: [],
					stickers: [],
					reactions: [],
					flags: 0,
					pinned: false,
					tts: false,
					mention_everyone: false,
					mentions: [],
				},
			}),
			channel,
		);
		expect(div.querySelector(".replytext")).toBeNull();
		const block = div.querySelector(".forwardBlock");
		expect(block).not.toBeNull();
		// The snapshot is the render source, never the create event's referenced_message.
		expect(block!.textContent).toContain("forwarded hello");
		expect(block!.textContent).not.toContain("original secret");
		expect((channel as any).messages.has("1000000000000001")).toBe(false);
	});

	it("re-rendering keeps exactly one forward block", () => {
		const {channel} = setupTestChannel();
		const {m, div} = render(forwardJson(channel), channel);
		m.generateMessage(undefined, false, div);
		expect(div.querySelectorAll(".forwardBlock").length).toBe(1);
	});

	it("clicking a forwarded image opens the viewer on the snapshot's images", async () => {
		const {ImagesDisplay} = await import("./disimg");
		const {channel} = setupTestChannel();
		const {div} = render(
			forwardJson(channel, {
				message_snapshots: [
					{
						message: {
							content: "",
							type: 0,
							timestamp: "2026-10-16T12:00:00+00:00",
							attachments: [
								{
									id: "img-1",
									filename: "forwarded.png",
									content_type: "image/png",
									url: "http://dm.test/cdn/forwarded.png",
									size: 5,
								},
							],
						},
					},
				],
			}),
			channel,
		);
		let captured: {files: unknown[]; index: number} | undefined;
		const show = vi
			.spyOn(ImagesDisplay.prototype, "show")
			.mockImplementation(function (this: {files: unknown[]; index: number}) {
				captured = this;
			});
		(div.querySelector(".forwardBlock img") as HTMLImageElement).click();
		expect(show).toHaveBeenCalled();
		expect(captured!.files).toHaveLength(1);
		expect(captured!.index).toBe(0);
	});

	it("replying to a forward previews the snapshot content", async () => {
		const {channel} = setupTestChannel();
		const fwd = new Message(forwardJson(channel, {id: "fw2"}) as never, channel as never);
		(channel as any).getmessage = async (id: string) => (id === "fw2" ? fwd : null);
		const replyJson = {
			id: "msg-reply-2",
			type: 0,
			content: "a reply",
			timestamp: "2026-10-16T12:00:00+00:00",
			edited_timestamp: null,
			author: {id: "author-2", username: "Replier"},
			attachments: [],
			embeds: [],
			stickers: [],
			reactions: [],
			flags: 0,
			pinned: false,
			tts: false,
			mention_everyone: false,
			mentions: [],
			channel_id: channel.id,
			guild_id: "@me",
			// Read paths omit referenced_message for forwards: the preview resolves via getmessage.
			message_reference: {message_id: "fw2", channel_id: channel.id, type: 0},
		};
		const {div} = render(replyJson, channel);
		// The preview fills from getmessage's promise, a microtask after the render.
		await vi.waitFor(() => {
			expect(div.querySelector(".replytext")!.textContent).toContain("forwarded hello");
		});
	});
});
