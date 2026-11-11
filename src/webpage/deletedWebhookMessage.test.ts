import {afterEach, describe, expect, it} from "vitest";
import type {messagejson} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Message} = await import("./message");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://deletedwebhook.test";
const WEBHOOK_ID = "900000000000000001";

/** The wire payload machloket-server sends for a webhook message once the webhook is gone:
 * the message keeps its dangling webhook_id and the stand-in webhook embed — the last name
 * and avatar survive, the ids behind them do not. The embed carries no id and no
 * guild_id/channel_id, user_id is present but null, and source_guild_id is absent for
 * non-follower webhooks. source_channel_id stays deliberately populated here, pinning the
 * tolerated string arm of the type (the variant below covers it null). */
function deletedWebhookMessage(): messagejson {
	return {
		id: "900000000000000002",
		type: 0,
		channel_id: "200",
		guild_id: "1",
		timestamp: "2026-11-11T10:00:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		content: "hello",
		attachments: [],
		embeds: [],
		author: {
			id: WEBHOOK_ID,
			username: "Hook",
			discriminator: "0000",
			avatar: "a_hash",
			bot: true,
			public_flags: 0,
			accent_color: 0,
			banner: undefined,
			bio: "",
			premium_since: "",
			premium_type: 0,
			theme_colors: null,
			badge_ids: [],
		},
		webhook_id: WEBHOOK_ID,
		webhook: {
			type: 1,
			name: "Hook",
			avatar: "a_hash",
			user_id: null,
			application_id: null,
			source_guild_id: undefined,
			source_channel_id: "200",
		},
		flags: 0,
		pinned: false,
		nonce: "",
	};
}

/** Tolerance variant: source_* present-but-null as the live server sends, and user_id
 * dropped from the embed outright. None of the identity fields behind a deleted webhook
 * can be relied on, so the client must decode and render without any of them. */
function deletedWebhookMessageNoUser(): messagejson {
	const m = deletedWebhookMessage();
	m.webhook = {
		type: 1,
		name: "Hook",
		avatar: "a_hash",
		application_id: null,
		source_guild_id: null,
		source_channel_id: null,
	};
	return m;
}

/** A channel whose fixture surface is wide enough for the real wire decode (`new Message`)
 * and a full `generateMessage` render, as a live channel build would run them. */
function buildChannel() {
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		userMap: new Map(),
		guilds: [],
		guildids: new Map(),
		channelids: new Map(),
		messages: new Map(),
		interNonceMap: new Map(),
		info: {api: API + "/api/v9", cdn: API + "/cdn", wellknown: API},
		headers: {},
		user: {id: "me"},
	}) as InstanceType<typeof Localuser>;
	const guild = {
		id: "@me",
		getpfpsrc: () => API + "/cdn/embed/avatars/0.png",
		roleids: new Map(),
	};
	const channel = {
		id: "200",
		owner: guild,
		guild,
		localuser,
		info: {api: API + "/api/v9", wellknown: API},
		headers: {},
		messages: new Map(),
		idToPrev: new Map(),
		infinite: {snapBottom: () => () => {}},
		lastmessageid: "0",
	};
	return {localuser, channel};
}

describe("a deleted webhook's message", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("decodes its author with the webhook's saved name and avatar", () => {
		const {channel} = buildChannel();
		const m = new Message(deletedWebhookMessage(), channel as never);

		expect(m.author.webhook).toBeDefined();
		expect(m.author.name).toBe("Hook");
		expect(m.author.getpfpsrc()).toContain("a_hash");
	});

	it("renders the WEBHOOK tag, not the BOT tag, without crashing on the null ids", () => {
		const {channel} = buildChannel();
		const m = new Message(deletedWebhookMessage(), channel as never);
		const div = document.createElement("div");
		document.body.append(div);

		m.generateMessage(undefined, false, div);

		const tag = div.querySelector(".bot");
		expect(tag).not.toBeNull();
		expect(tag?.textContent).toBe(I18n.webhook());
		expect(tag?.textContent).not.toBe(I18n.bot());
		expect(div.querySelector(".username")?.textContent).toBe("Hook");
	});

	it("tolerates an embed without user_id and with null source ids", () => {
		const {channel} = buildChannel();
		const m = new Message(deletedWebhookMessageNoUser(), channel as never);
		const div = document.createElement("div");
		document.body.append(div);

		m.generateMessage(undefined, false, div);

		const tag = div.querySelector(".bot");
		expect(tag).not.toBeNull();
		expect(tag?.textContent).toBe(I18n.webhook());
		expect(div.querySelector(".username")?.textContent).toBe("Hook");
	});
});
