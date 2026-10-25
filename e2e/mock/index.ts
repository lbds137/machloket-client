/**
 * Route-mocked Spacebar instance for Playwright e2e tests.
 *
 * Covered URL surface (same-origin at http://localhost:4173 so the shared OFF_ORIGIN abort net
 * in e2e/fixtures.ts spares these routes while aborting any accidental external network traffic):
 *
 * Static / discovery:
 * - GET  /instances.json                            -> MOCK_INSTANCES (picker entry + bundled survivor)
 * - GET  /.well-known/spacebar/client               -> MOCK_WELL_KNOWN (api, gateway, cdn baseUrls)
 * - GET  /custom-badges.json                        -> MOCK_CUSTOM_BADGES (empty users/bots map)
 * - GET  /embed/avatars/:index.png                  -> 1x1 PNG (default user/member avatars)
 * - GET  /icons/:guildId/:hash.png                  -> 1x1 PNG (guild icon; .png only -
 *                                                      bundled /icons/*.svg pass through)
 * - GET  /getupdates                                -> 200 text "e2e-mock" (the short-rev
 *                                                      nonce base; plain text by design)
 *
 * REST API (/api/v9 and /_spacebar):
 * - GET  /api/v9/ping                               -> MOCK_PING (instance metadata + tosPage: null)
 * - GET  /api/v9/policies/instance/config           -> MOCK_POLICIES_CONFIG (can_recover_account: false)
 * - POST /api/v9/auth/login                         -> MOCK_LOGIN_RESPONSE (neutral e2e-mock-token)
 * - GET  /api/v9/users/@me/settings-proto/2/json    -> MOCK_SETTINGS_PROTO (empty favoriteGifs proto)
 * - PATCH /api/v9/users/@me/settings-proto/2/json   -> MOCK_SETTINGS_PROTO
 * - GET  /_spacebar/api/v1/integrations/gif         -> MOCK_GIF_INTEGRATIONS (empty GIF providers)
 * - GET  /api/v9/guilds/:guildId/welcome-screen     -> MOCK_WELCOME_SCREEN (enabled: false)
 * - GET  /api/v9/guilds/:guildId/application-command-index -> MOCK_COMMAND_INDEX (3 chat-input
 *                                                      commands: visible / admins-only / denied)
 * - GET  /api/v9/guilds/:guildId/members/:userId    -> MOCK member (Member.resolveMember)
 * - GET  /api/v9/channels/:channelId/messages       -> MOCK_MESSAGES (newest-first; before/after pages -> [])
 * - POST /api/v9/channels/:channelId/messages       -> 200 {} (a sent message, e.g. the forward
 *                                                      flow's send; pinned from capturedRequests)
 * - POST /api/v9/channels/:channelId/messages/:id/ack -> 200 {token: null}
 * - POST /api/v9/read-states/ack-bulk               -> 200 {token: null}
 * - GET  /api/v9/users/:userId/profile              -> user profile + empty badges/mutuals
 * - POST /api/v9/interactions                       -> 204 No Content
 * - GET  /api/v9/invites/:code                      -> MOCK_INVITE (the invite page's preview)
 * - POST /api/v9/invites/:code                      -> {guild: {id}} (acceptInvite's join)
 * - Any other /api/*, /.well-known/*, /_spacebar/*  -> route.abort("failed") so missed routes fail loudly
 *
 * Gateway WebSocket (ws://localhost:4173):
 * - Server -> Client on connect: op 10 HELLO ({heartbeat_interval: 41250})
 * - Client -> Server op 1 / op 40 (heartbeat)       -> Server op 11 HEARTBEAT_ACK
 * - Client -> Server op 2 (IDENTIFY)                -> Server op 0 READY (carries the blocked
 *                                                      peer's type-2 relationship), then op 0
 *                                                      GUILD_CREATE
 * - Client -> Server op 8 (REQUEST_GUILD_MEMBERS)   -> Server op 0 GUILD_MEMBERS_CHUNK (+ CHANNEL_UPDATE)
 * - Client -> Server op 6 (RESUME)                  -> Server op 9 invalid session: no state is
 *                                                      kept, the app re-identifies afresh and the
 *                                                      op 2 path replays READY + GUILD_CREATE
 * - Client -> Server op 14 is not answered (member-list events; only a desktop-profile
 *   spec with a visible member list would need GUILD_MEMBER_LIST_UPDATE)
 */

import type {Page, Route} from "@playwright/test";
import type {ModalCreateEvent} from "../../src/webpage/interactions/modal";
import {MessageComponentType} from "../../src/webpage/jsontypes";
import type {
	actionRow,
	button,
	channeljson,
	commandJson,
	embedjson,
	guildjson,
	mainuserjson,
	memberjson,
	messagejson,
	readyjson,
	rolesjson,
	select,
	userjson,
	welcomeScreen,
} from "../../src/webpage/jsontypes";
import type {ListedInstance} from "../../src/webpage/utils/instanceOverlay";

export const MOCK_INSTANCE_ORIGIN = "http://localhost:4173";
export const MOCK_INSTANCE_NAME = "Mock Instance";
export const MOCK_TOKEN = "e2e-mock-token";

export const MOCK_USER_ID = "1200000000000000001";
export const MOCK_BOT_USER_ID = "1200000000000000002";
export const MOCK_GUILD_ID = "1200000000000000100";
export const MOCK_CHANNEL_ID = "1200000000000000200";
export const MOCK_BUTTON_MESSAGE_ID = "1200000000000000300";
export const MOCK_TEXT_MESSAGE_ID = "1200000000000000301";
export const MOCK_SELECT_MESSAGE_ID = "1200000000000000302";
export const MOCK_EMBED_MESSAGE_ID = "1200000000000000299";
export const MOCK_SINGLE_SELECT_MESSAGE_ID = "1200000000000000305";
export const MOCK_BLOCKED_MESSAGE_B_ID = "1200000000000000298";
export const MOCK_BLOCKED_MESSAGE_A_ID = "1200000000000000297";
export const MOCK_FORWARD_MESSAGE_ID = "1200000000000000296";
export const MOCK_BLOCKED_USER_ID = "1200000000000000003";

// 1x1 transparent PNG so default avatar requests (/embed/avatars/*.png, guild.ts member icons) settle 200.
const TRANSPARENT_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
	"base64",
);

// src/webpage/utils/instanceOverlay.ts (ListedInstance / mergeInstanceLists) and the
// home picker cards in src/webpage/home.ts
export const MOCK_INSTANCES: ListedInstance[] = [
	{
		name: MOCK_INSTANCE_NAME,
		description: "Playwright route-mocked Spacebar instance",
		url: MOCK_INSTANCE_ORIGIN,
	},
	{
		name: "Spacebar",
		description: "Official Spacebar Instance",
		url: "https://spacebar.chat",
		icon: "/icons/Spacebar.svg",
	},
];

// src/webpage/utils/utils.ts (getApiUrlsV2 well-known discovery)
// src/webpage/test/setup.ts (addInstance template)
export const MOCK_WELL_KNOWN = {
	api: {
		baseUrl: MOCK_INSTANCE_ORIGIN,
		apiVersions: {default: "9"},
	},
	gateway: {
		baseUrl: "ws://localhost:4173",
		encoding: ["json"],
		compression: ["zlib-stream"],
	},
	cdn: {
		baseUrl: MOCK_INSTANCE_ORIGIN,
	},
};

// src/webpage/localuser.ts (isPing / pingEndpoint)
// src/webpage/register.ts (tosLogic reads json.instance.tosPage)
export const MOCK_PING = {
	ping: "pong!",
	instance: {
		id: "100000000000000000",
		name: MOCK_INSTANCE_NAME,
		description: "Playwright route-mocked Spacebar instance",
		image: null,
		correspondenceEmail: null,
		correspondenceUserID: null,
		frontPage: null,
		tosPage: null,
	},
};

// src/webpage/login.ts (recover checks res.can_recover_account)
export const MOCK_POLICIES_CONFIG = {
	can_recover_account: false,
};

// src/webpage/login.ts (makeLogin onSubmit reads res.token)
// src/webpage/test/setup.ts (acceptAuth template)
export const MOCK_LOGIN_RESPONSE = {
	token: MOCK_TOKEN,
	settings: {
		locale: "en",
		theme: "dark",
	},
};

// src/webpage/favorites.ts (the settings-proto GET/PATCH)
export const MOCK_SETTINGS_PROTO = {
	settings: {},
};

// src/webpage/localuser.ts (gottenReady fetches /_spacebar/api/v1/integrations/gif)
export const MOCK_GIF_INTEGRATIONS = {
	providers: {},
};

// src/webpage/user.ts (loadCustomBadgeFile fetches /custom-badges.json)
export const MOCK_CUSTOM_BADGES = {
	users: {},
	bots: {},
};

// src/webpage/guild.ts (showWelcome fetches /guilds/:id/welcome-screen on GUILD_CREATE)
export const MOCK_WELCOME_SCREEN: welcomeScreen = {
	enabled: false,
	description: "",
	welcome_channels: [],
};

// src/webpage/localuser.ts (gottenReady constructs User from ready.d.user)
// src/webpage/jsontypes.ts (mainuserjson)
export const MOCK_USER: mainuserjson = {
	id: MOCK_USER_ID,
	username: "testuser",
	discriminator: "0001",
	avatar: null,
	bot: false,
	nsfw_allowed: true,
	public_flags: 0,
	bio: "",
	accent_color: 0,
	theme_colors: null,
	pronouns: "",
	flags: 0,
	mfa_enabled: false,
	premium: false,
	premium_type: 0,
	premium_since: "",
	purchased_flags: 0,
	premium_usage_flags: 0,
	verified: true,
	disabled: false,
	email: "testuser@example.test",
	badge_ids: [],
};

// src/webpage/user.ts (User.checkuser) & src/webpage/interactions/compontents.ts (compObj.bot)
// src/webpage/jsontypes.ts (userjson)
export const MOCK_BOT_USER: userjson = {
	id: MOCK_BOT_USER_ID,
	username: "HelperBot",
	discriminator: "0001",
	avatar: null,
	bot: true,
	public_flags: 0,
	bio: "",
	accent_color: 0,
	theme_colors: null,
	pronouns: "",
	premium_type: 0,
	premium_since: "",
	badge_ids: [],
};

// src/webpage/role.ts & src/webpage/channel.ts (hasPermission checks @everyone role id === guild.id)
// Bits: VIEW_CHANNEL (1<<10 = 1024) | SEND_MESSAGES (1<<11 = 2048) | READ_MESSAGE_HISTORY (1<<16 = 65536) = 68608.
// Deliberately NOT admin (no 1<<3): the slash-perm pins need a member whose filtering is
// visible - an ADMINISTRATOR passes memberCanSee for everything.
export const MOCK_EVERYONE_ROLE: rolesjson = {
	id: MOCK_GUILD_ID,
	guild_id: MOCK_GUILD_ID,
	name: "@everyone",
	color: 0,
	hoist: false,
	position: 0,
	permissions: "68608",
	managed: false,
	mentionable: false,
	icon: "",
	unicode_emoji: "",
	flags: 0,
};

// src/webpage/channel.ts (Channel constructor) & (createguildHTML button.channelbutton)
// src/webpage/jsontypes.ts (channeljson)
export const MOCK_CHANNEL: channeljson = {
	member: {
		id: MOCK_USER_ID,
		user_id: MOCK_USER_ID,
		join_timestamp: "2025-01-01T00:00:00.000Z",
		flags: 0,
		muted: false,
	},
	id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	name: "general",
	type: 0,
	topic: "General discussion",
	nsfw: false,
	position: 0,
	last_message_id: MOCK_SINGLE_SELECT_MESSAGE_ID,
	rate_limit_per_user: 0,
	permission_overwrites: [],
	default_auto_archive_duration: 1440,
	created_at: "2025-01-01T00:00:00.000Z",
	icon: "",
	owner_id: MOCK_USER_ID,
	parent_id: "",
	last_pin_timestamp: "",
	video_quality_mode: null,
	retention_policy_id: "",
	flags: 0,
	default_thread_rate_limit_per_user: 0,
};

// A channel @everyone can't view (VIEW_CHANNEL = 1 << 10 denied): a deep link to it must
// land in the guild's visible fallback, never focus it.
export const MOCK_HIDDEN_CHANNEL_ID = "1200000000000000201";
export const MOCK_HIDDEN_CHANNEL: channeljson = {
	...MOCK_CHANNEL,
	id: MOCK_HIDDEN_CHANNEL_ID,
	name: "staff",
	topic: "",
	position: 1,
	permission_overwrites: [{id: MOCK_GUILD_ID, allow: "0", deny: "1024"}],
};

// src/webpage/guild.ts (Guild constructor) & (generateGuildIcon)
// src/webpage/jsontypes.ts (guildjson)
export const MOCK_GUILD: guildjson = {
	application_command_counts: {},
	channels: [MOCK_CHANNEL, MOCK_HIDDEN_CHANNEL],
	threads: [],
	data_mode: "",
	emojis: [],
	guild_scheduled_events: [],
	id: MOCK_GUILD_ID,
	large: false,
	lazy: false,
	member_count: 2,
	premium_subscription_count: 0,
	properties: {
		region: "en-US",
		name: "Mock Guild",
		description: "Fixture guild for e2e tests",
		icon: "e2eicon",
		splash: "",
		banner: "",
		features: [],
		preferred_locale: "en-US",
		// NOT the fixture member: guild.ts memberCanSee's owner bypass passes everything,
		// which would silent the slash-perm pins. The bot persona owns the guild.
		owner_id: MOCK_BOT_USER_ID,
		application_id: "",
		afk_channel_id: "",
		afk_timeout: 300,
		member_count: 2,
		system_channel_id: MOCK_CHANNEL_ID,
		verification_level: 0,
		explicit_content_filter: 0,
		default_message_notifications: 0,
		mfa_level: 0,
		vanity_url_code: 0,
		premium_tier: 0,
		premium_progress_bar_enabled: false,
		system_channel_flags: 0,
		discovery_splash: "",
		rules_channel_id: "",
		public_updates_channel_id: "",
		max_video_channel_users: 25,
		max_members: 250000,
		nsfw_level: 0,
		nsfw: false,
		hub_type: null,
		home_header: null,
		id: MOCK_GUILD_ID,
		latest_onboarding_question_id: "",
		max_stage_video_channel_users: 50,
		safety_alerts_channel_id: "",
	},
	roles: [MOCK_EVERYONE_ROLE],
	stage_instances: [],
	stickers: [],
	version: "",
	guild_hashes: {},
	joined_at: "2025-01-01T00:00:00.000Z",
};

// src/webpage/member.ts (Member.new) & src/webpage/localuser.ts (gotChunk / getmembers)
// src/webpage/jsontypes.ts (memberjson)
export const MOCK_MEMBER: memberjson = {
	id: MOCK_USER_ID,
	user: MOCK_USER,
	guild: {id: MOCK_GUILD_ID},
	guild_id: MOCK_GUILD_ID,
	roles: [MOCK_GUILD_ID],
	joined_at: "2025-01-01T00:00:00.000Z",
	premium_since: "",
	deaf: false,
	mute: false,
	pending: false,
};

export const MOCK_BOT_MEMBER: memberjson = {
	id: MOCK_BOT_USER_ID,
	user: MOCK_BOT_USER,
	guild: {id: MOCK_GUILD_ID},
	guild_id: MOCK_GUILD_ID,
	roles: [MOCK_GUILD_ID],
	joined_at: "2025-01-01T00:00:00.000Z",
	premium_since: "",
	deaf: false,
	mute: false,
	pending: false,
};

// src/webpage/user.ts (handleRelationship: relationshipType = relation.type) — READY
// carries the type-2 relationship, and User.checkuser hands every later resolution the
// SAME instance, so messages by this peer render the blocked run (message.ts
// generateMessage's relationshipType === 2 branches).
export const MOCK_BLOCKED_USER: userjson = {
	id: MOCK_BLOCKED_USER_ID,
	username: "BlockedPeer",
	discriminator: "0004",
	avatar: null,
	bot: false,
	public_flags: 0,
	bio: "",
	accent_color: 0,
	theme_colors: null,
	pronouns: "",
	premium_type: 0,
	premium_since: "",
	badge_ids: [],
};

export const MOCK_BLOCKED_MEMBER: memberjson = {
	id: MOCK_BLOCKED_USER_ID,
	user: MOCK_BLOCKED_USER,
	guild: {id: MOCK_GUILD_ID},
	guild_id: MOCK_GUILD_ID,
	roles: [MOCK_GUILD_ID],
	joined_at: "2025-01-01T00:00:00.000Z",
	premium_since: "",
	deaf: false,
	mute: false,
	pending: false,
};

// src/webpage/interactions/compontents.ts (class ActionRow) & (class Select -> FancySelect)
// src/webpage/utils/fancySelect.ts (FancySelect phone sheet options, min/max)
// src/webpage/jsontypes.ts (MessageComponentType.ActionRow = 1, MessageComponentType.StringSelect = 3)
export const MOCK_SINGLE_SELECT_ROW: actionRow = {
	type: MessageComponentType.ActionRow,
	components: [
		{
			type: MessageComponentType.StringSelect,
			custom_id: "e2e-single-select",
			// Dead data: the app drops a select's placeholder (compontents.ts passes only
			// label/value/description/default + min/max) - filed as a parity gap.
			placeholder: "Pick one role",
			min_values: 1,
			max_values: 1,
			options: [
				{label: "Alpha", value: "alpha", description: "First pick", default: false},
				{label: "Beta", value: "beta", description: "Second pick", default: false},
				{label: "Gamma", value: "gamma", description: "Third pick", default: false},
			],
		} satisfies select,
	],
};

export const MOCK_SELECT_ROW: actionRow = {
	type: MessageComponentType.ActionRow,
	components: [
		{
			type: MessageComponentType.StringSelect,
			custom_id: "e2e-role-select",
			placeholder: "Pick notification roles",
			min_values: 1,
			max_values: 2,
			options: [
				{
					label: "Announcements",
					value: "announcements",
					description: "Release and outage notices",
					default: false,
				},
				{
					label: "Builds",
					value: "builds",
					description: "CI and nightly build alerts",
					default: false,
				},
				{
					label: "Releases",
					value: "releases",
					description: "Tagged version announcements",
					default: false,
				},
			],
		} satisfies select,
	],
};

// src/webpage/interactions/compontents.ts (class Button -> postInteraction; the bot's modal
// comes back as a gateway INTERACTION_MODAL_CREATE keyed by the POST's nonce, not in the
// REST response — compontents.ts postInteraction ignores the response body)
export const MOCK_BUTTON_ROW: actionRow = {
	type: MessageComponentType.ActionRow,
	components: [
		{
			type: MessageComponentType.Button,
			style: 1,
			label: "Open form",
			custom_id: "e2e-form-button",
		} satisfies button,
	],
};

// A bot's form taller than a phone screen with the keyboard up: three paragraph fields
// plus a select (mirrors src/webpage/interactions/modalPhone.test.ts's tallModal). The
// nonce is the one from the interaction POST that opened it — a spec reads it back from
// capturedRequests and sends INTERACTION_MODAL_CREATE via sendGatewayEvent.
function paragraph(custom_id: string) {
	return {
		type: 18,
		label: custom_id,
		component: {type: 4, custom_id, style: 2, required: false},
	};
}
// src/webpage/interactions/modal.ts (FieldDef: required !== false; textField problem():
// empty + required -> I18n.interactions.modalRequired, length outside
// min_length..max_length -> modalLength). A one-line required field and an optional
// one with a length window — the client-side validation pins submit against it.
export const MOCK_REQUIRED_MODAL: Omit<ModalCreateEvent, "nonce"> = {
	id: "1200000000000000401",
	channel_id: MOCK_CHANNEL_ID,
	custom_id: "e2e-validated-form",
	title: "Validated",
	application: {id: MOCK_BOT_USER_ID, name: "HelperBot"},
	components: [
		{type: 18, label: "Required", component: {type: 4, custom_id: "must", style: 1, required: true}},
		{
			type: 18,
			label: "Length window",
			component: {
				type: 4,
				custom_id: "window",
				style: 1,
				required: false,
				min_length: 5,
				max_length: 10,
			},
		},
	],
};
export const MOCK_FORM_MODAL: Omit<ModalCreateEvent, "nonce"> = {
	id: "1200000000000000400",
	channel_id: MOCK_CHANNEL_ID,
	custom_id: "e2e-form",
	title: "Row 9",
	application: {id: MOCK_BOT_USER_ID, name: "HelperBot"},
	components: [
		{type: 10, content: "Some words about the form.\n\nAnd some more."},
		paragraph("first"),
		paragraph("second"),
		paragraph("third"),
		{
			type: 18,
			label: "Select",
			component: {type: 3, custom_id: "pick", required: false, options: [{label: "A", value: "a"}]},
		},
	],
};

// src/webpage/embed.ts (generateRich: thumbnail floats top-right beside the text;
// generateArticle: a "video" embed renders its thumbnail and swaps to a YouTube player
// iframe on tap via youtubeEmbedSrc). The image host is 127.0.0.1 - deliberately a
// different host than the mock's cdn (localhost:4173) so localuser.refreshIfNeeded
// returns the URLs untouched instead of batching a POST /attachments/refresh-urls;
// real embed images point at third-party hosts anyway. e2e/embeds.spec.ts fulfills
// these paths with inline SVGs.
export const MOCK_EMBED_THUMB_URL = "http://127.0.0.1:4173/e2e-assets/character-thumb.svg";
export const MOCK_EMBED_POSTER_URL = "http://127.0.0.1:4173/e2e-assets/video-poster.svg";

export const MOCK_RICH_EMBED: embedjson = {
	type: "rich",
	color: 0x5865f2,
	provider: {name: "CardBot"},
	author: {name: "CardBot"},
	title: "Character: Juniper",
	description: "Level 12 wanderer with a knack for finding trouble.",
	fields: [
		{name: "Class", value: "Wanderer", inline: true},
		{name: "Level", value: "12", inline: true},
	],
	footer: {text: "CardBot • e2e"},
	timestamp: "2025-01-01T11:58:00.000Z",
	thumbnail: {url: MOCK_EMBED_THUMB_URL, proxy_url: MOCK_EMBED_THUMB_URL, width: 48, height: 48},
};

export const MOCK_VIDEO_EMBED: embedjson = {
	type: "video",
	// embedjson requires `author` on every embed; the article renderer never reads it.
	author: {},
	provider: {name: "YouTube"},
	title: "e2e fixture clip",
	video: {url: "https://www.youtube.com/embed/e2eFixtured01"},
	thumbnail: {url: MOCK_EMBED_POSTER_URL, proxy_url: MOCK_EMBED_POSTER_URL, width: 480, height: 360},
};

// The /invite/:code page (src/webpage/invite.ts) reads guild.name/icon/banner/
// discovery_splash + inviter.username off the preview answer; acceptInvite (utils/
// acceptInvite.ts) POSTs the same path and reads {guild:{id}} (or the old guild_id).
// The guild is the mock's own, so an accept lands /channels/:guildId in the booted app.
export const MOCK_INVITE_CODE = "e2e-invite";
export const MOCK_INVITE = {
	code: MOCK_INVITE_CODE,
	guild: {
		id: MOCK_GUILD_ID,
		name: "Mock Guild",
		icon: null,
		banner: null,
		discovery_splash: null,
	},
	inviter: {id: MOCK_BOT_USER_ID, username: "HelperBot"},
	channel: {name: "general"},
};

// src/webpage/guild.ts (getCommandsFetch / getCommands: chat-input type 1 only;
// memberCanSee: per-command overrides via commandAllowedFor, then default_member_permissions
// where "0" is Discord's admins-only). The member holds only 68608 - no ADMINISTRATOR - so
// the two hidden commands below are hidden BY the pins being tested. The app's owner is the
// bot itself, so the app-owner bypass can't leak the denied command either.
let commandIdCounter = 500;
function command(
	name: string,
	extra: Pick<commandJson, "default_member_permissions" | "permissions">,
): commandJson {
	return {
		id: "1200000000000000" + commandIdCounter++,
		type: 1,
		application_id: MOCK_BOT_USER_ID,
		guild_id: MOCK_GUILD_ID,
		name,
		description: "e2e command " + name,
		dm_permission: false,
		nsfw: false,
		global_popularity_rank: 0,
		version: "1",
		handler: 1,
		...extra,
	};
}
export const MOCK_COMMAND_INDEX: {application_commands: commandJson[]; applications: unknown[]} = {
	application_commands: [
		command("e2evisible", {}),
		// "0" = admins-only; the member is not one.
		command("e2eadminonly", {default_member_permissions: "0"}),
		// An explicit per-user deny outranks everything but the bypasses.
		// An explicit deny in the command's permissions table outranks everything but the
		// bypasses (Spacebar's shape: `user` is one boolean on the command, not an id map).
		command("e2edenied", {permissions: {user: false}}),
	],
	applications: [{id: MOCK_BOT_USER_ID, name: "HelperBot", owner_id: MOCK_BOT_USER_ID}],
};

// src/webpage/message.ts (generateMessage: message_reference.type === 1 renders the
// forwardBlock card from message_snapshots[0]; the reply-bar path skips type 1) —
// the card labels the SOURCE channel from message_reference.channel_id.
export const MOCK_FORWARD_MESSAGE: messagejson = {
	id: MOCK_FORWARD_MESSAGE_ID,
	channel_id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	author: MOCK_BOT_USER,
	member: MOCK_BOT_MEMBER,
	content: "",
	timestamp: "2025-01-01T11:55:00.000Z",
	edited_timestamp: null,
	tts: false,
	mention_everyone: false,
	mentions: [],
	mention_roles: [],
	attachments: [],
	embeds: [],
	reactions: [],
	nonce: "e2e-nonce-4",
	pinned: false,
	type: 0,
	message_reference: {type: 1, channel_id: MOCK_CHANNEL_ID, message_id: MOCK_TEXT_MESSAGE_ID},
	message_snapshots: [
		{
			message: {
				content: "Forwarded from earlier: the original answer, kept verbatim.",
				timestamp: "2025-01-01T10:00:00.000Z",
				edited_timestamp: null,
				type: 0,
				attachments: [],
				embeds: [],
				mentions: [],
				mention_roles: [],
			},
		},
	],
};

// The blocked peer's run: two consecutive messages collapsing behind one bar
// (message.ts generateMessage: the run's first build gets .blocked.topMessage and the
// showBlockedMessages count; later ones go zeroheight until expanded via ignoredblock).
export const MOCK_BLOCKED_MESSAGES: messagejson[] = [
	{
		id: MOCK_BLOCKED_MESSAGE_B_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_BLOCKED_USER,
		member: MOCK_BLOCKED_MEMBER,
		content: "blocked message two",
		timestamp: "2025-01-01T11:57:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [],
		reactions: [],
		nonce: "e2e-nonce-5",
		pinned: false,
		type: 0,
	},
	{
		id: MOCK_BLOCKED_MESSAGE_A_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_BLOCKED_USER,
		member: MOCK_BLOCKED_MEMBER,
		content: "blocked message one",
		timestamp: "2025-01-01T11:56:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [],
		reactions: [],
		nonce: "e2e-nonce-6",
		pinned: false,
		type: 0,
	},
];

// The single-select sheet's message: the run's newest (bottom-most in #general), whose
// tap answers immediately - radio markers, no Apply footer (fancySelect.ts multi !== 1).
export const MOCK_SINGLE_MESSAGE: messagejson = {
	id: MOCK_SINGLE_SELECT_MESSAGE_ID,
	channel_id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	author: MOCK_BOT_USER,
	member: MOCK_BOT_MEMBER,
	content: "Pick exactly one:",
	timestamp: "2025-01-01T12:02:00.000Z",
	edited_timestamp: null,
	tts: false,
	mention_everyone: false,
	mentions: [],
	mention_roles: [],
	attachments: [],
	embeds: [],
	reactions: [],
	nonce: "e2e-nonce-7",
	pinned: false,
	type: 0,
	components: [MOCK_SINGLE_SELECT_ROW],
};

// src/webpage/channel.ts (putmessages expects newest-first array from GET /channels/:id/messages?limit=100)
// src/webpage/message.ts (Message constructor) & src/webpage/jsontypes.ts (messagejson)
export const MOCK_MESSAGES: messagejson[] = [
	// The newest message, bottom-most in #general (the channel's last_message_id).
	MOCK_SINGLE_MESSAGE,
	{
		id: MOCK_SELECT_MESSAGE_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_BOT_USER,
		member: MOCK_BOT_MEMBER,
		content: "Choose a notification role:",
		timestamp: "2025-01-01T12:01:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [],
		reactions: [],
		nonce: "e2e-nonce-2",
		pinned: false,
		type: 0,
		components: [MOCK_SELECT_ROW],
	},
	{
		id: MOCK_TEXT_MESSAGE_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_USER,
		member: MOCK_MEMBER,
		content: "Welcome to the mock guild!",
		timestamp: "2025-01-01T12:00:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [],
		reactions: [],
		nonce: "e2e-nonce-1",
		pinned: false,
		type: 0,
	},
	{
		id: MOCK_BUTTON_MESSAGE_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_BOT_USER,
		member: MOCK_BOT_MEMBER,
		content: "Need some details:",
		timestamp: "2025-01-01T11:59:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [],
		reactions: [],
		nonce: "e2e-nonce-0",
		pinned: false,
		type: 0,
		components: [MOCK_BUTTON_ROW],
	},
	{
		// Sits between the button message and the blocked run below; the select stays
		// bottom-most, as T3 arranged, and the run above is the new bottom of the array.
		id: MOCK_EMBED_MESSAGE_ID,
		channel_id: MOCK_CHANNEL_ID,
		guild_id: MOCK_GUILD_ID,
		author: MOCK_BOT_USER,
		member: MOCK_BOT_MEMBER,
		content: "Bot cards look like this:",
		timestamp: "2025-01-01T11:58:00.000Z",
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		attachments: [],
		embeds: [MOCK_RICH_EMBED, MOCK_VIDEO_EMBED],
		reactions: [],
		nonce: "e2e-nonce-3",
		pinned: false,
		type: 0,
	},
	...MOCK_BLOCKED_MESSAGES,
	// Last in this newest-first array, so it renders at the TOP of #general: the
	// forward card sits above the collapsed blocked run.
	MOCK_FORWARD_MESSAGE,
];

// src/webpage/localuser.ts (op 10 HELLO starts heartbeat interval and sends op 1)
export const MOCK_HELLO_FRAME = {
	op: 10,
	d: {
		heartbeat_interval: 41_250,
	},
};

// src/webpage/localuser.ts (gottenReady) & (initwebsocket resolves on READY)
// src/webpage/jsontypes.ts (readyjson)
export const MOCK_READY_FRAME: readyjson = {
	op: 0,
	t: "READY",
	s: 1,
	d: {
		v: 9,
		user: MOCK_USER,
		user_settings: {
			index: 0,
			afk_timeout: 300,
			allow_accessibility_detection: false,
			animate_emoji: true,
			animate_stickers: 0,
			contact_sync_enabled: false,
			convert_emoticons: true,
			custom_status: "",
			default_guilds_restricted: false,
			detect_platform_accounts: true,
			developer_mode: false,
			disable_games_tab: false,
			enable_tts_command: false,
			explicit_content_filter: 0,
			friend_discovery_flags: 0,
			friend_source_flags: {all: false},
			gateway_connected: true,
			gif_auto_play: true,
			guild_folders: [],
			guild_positions: [],
			inline_attachment_media: true,
			inline_embed_media: true,
			locale: "en-US",
			message_display_compact: false,
			native_phone_integration_enabled: false,
			render_embeds: true,
			render_reactions: true,
			restricted_guilds: [],
			show_current_game: true,
			status: "online",
			stream_notifications_enabled: false,
			theme: "dark",
			timezone_offset: 0,
			view_nsfw_guilds: false,
		},
		guilds: [],
		relationships: [
			{
				id: MOCK_BLOCKED_USER_ID,
				type: 2,
				nickname: null,
				user: MOCK_BLOCKED_USER,
			},
		],
		private_channels: [],
		read_state: {entries: [], partial: false, version: 0},
		user_guild_settings: {entries: [], partial: false, version: 0},
		session_id: "e2e-mock-session",
		country_code: "US",
		users: [],
		merged_members: [],
		sessions: [],
		resume_gateway_url: "ws://localhost:4173",
		consents: {personalization: {consented: true}},
		experiments: [],
		guild_join_requests: [],
		connected_accounts: [],
		guild_experiments: [],
		geo_ordered_rtc_regions: [],
		api_code_version: 9,
		friend_suggestion_count: 0,
		analytics_token: "e2e-mock-analytics",
		tutorial: false,
		session_type: "normal",
		auth_session_id_hash: "e2e-mock-hash",
		notification_settings: {flags: 0},
	},
};

// src/webpage/localuser.ts (case "GUILD_CREATE" constructs Guild, mounts icon, calls showWelcome)
export const MOCK_GUILD_CREATE_FRAME = {
	op: 0,
	t: "GUILD_CREATE",
	s: 2,
	d: MOCK_GUILD,
};

export interface CapturedRequest {
	url: string;
	pathname: string;
	method: string;
	body: unknown;
}

export interface MockInstanceOptions {
	/** Override initial channel messages returned by GET /api/v9/channels/:id/messages. */
	messages?: messagejson[];
	/** Suppress the first-run "What's new" changelog modal (src/webpage/changelog.ts). Defaults to true. */
	suppressChangelog?: boolean;
}

export interface MockInstanceHandle {
	origin: string;
	api: string;
	gateway: string;
	token: string;
	capturedRequests: CapturedRequest[];
	gatewayFrames: {
		toApp: unknown[];
		fromApp: unknown[];
	};
	sendGatewayEvent: (frame: {op: number; t?: string; s?: number; d: unknown}) => void;
	/** Reassignable per test: a custom handler for POST /api/v9/auth/login (refusal tests
	 * fulfill a 401 here). Runs INSTEAD of the default fulfill when set. */
	onLogin?: (route: Route, body: unknown) => Promise<void> | void;
	/** Reassignable per test: a custom handler for POST /api/v9/interactions (modal refusal
	 * tests fulfill a 400 here). Runs INSTEAD of the default 204 fulfill when set. */
	onInteractions?: (route: Route, body: unknown) => Promise<void> | void;
}

/**
 * Mounts the route-mocked Spacebar instance on `page` (REST via `page.route` and
 * gateway WebSocket via `page.routeWebSocket`), modelled on `src/webpage/test/setup.ts`.
 */
export async function mountMockInstance(
	page: Page,
	options: MockInstanceOptions = {},
): Promise<MockInstanceHandle> {
	const {messages = MOCK_MESSAGES, suppressChangelog = true} = options;

	if (suppressChangelog) {
		// src/webpage/changelog.ts: "0" is the built-in sentinel that suppresses the
		// first-boot changelog Dialog so its backdrop does not intercept clicks on #servers.
		await page.addInitScript(() => {
			localStorage.setItem("fermoChangelogVersion", "0");
		});
	}

	const capturedRequests: CapturedRequest[] = [];
	// Mock-perspective names: toApp = mock -> app, fromApp = app -> mock.
	const gatewayFrames: {toApp: unknown[]; fromApp: unknown[]} = {
		toApp: [],
		fromApp: [],
	};
	const activeSockets = new Set<(payload: string) => void>();
	let seq = 2;

	const sendFrame = (
		send: (payload: string) => void,
		frame: {op: number; t?: string; s?: number; d: unknown},
	) => {
		gatewayFrames.toApp.push(frame);
		send(JSON.stringify(frame));
	};

	// Built before the routes so the handlers can read the live handle (per-test onLogin).
	const handle: MockInstanceHandle = {
		origin: MOCK_INSTANCE_ORIGIN,
		api: `${MOCK_INSTANCE_ORIGIN}/api/v9`,
		gateway: "ws://localhost:4173",
		token: MOCK_TOKEN,
		capturedRequests,
		gatewayFrames,
		sendGatewayEvent(frame) {
			if (frame.op === 0 && frame.s === undefined) {
				frame = {...frame, s: ++seq};
			}
			for (const send of activeSockets) {
				sendFrame(send, frame);
			}
		},
	};

	// Gateway WebSocket script (the gateway message loop)
	await page.routeWebSocket(/^ws:\/\/localhost:4173(\/|\?|$)/, (ws) => {
		const send = (payload: string) => ws.send(payload);
		activeSockets.add(send);

		// 1. Server greets immediately with op 10 HELLO (src/webpage/localuser.ts)
		sendFrame(send, MOCK_HELLO_FRAME);

		ws.onMessage((raw) => {
			const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
			let parsed: {op?: number; d?: Record<string, unknown>} | undefined;
			try {
				parsed = JSON.parse(text) as {op?: number; d?: Record<string, unknown>};
			} catch {
				return;
			}
			gatewayFrames.fromApp.push(parsed);

			// Heartbeat (op 1 first beat, op 40 QoS beats)
			if (parsed.op === 1 || parsed.op === 40) {
				sendFrame(send, {op: 11, d: {}});
				return;
			}

			// RESUME (op 6): no gateway state is kept across connections, so answer invalid
			// session; the app clears session_id, closes 4041, reconnects and identifies
			// afresh, and the op 2 branch below replays READY + GUILD_CREATE.
			if (parsed.op === 6) {
				sendFrame(send, {op: 9, d: false});
				return;
			}

			// IDENTIFY (op 2) -> READY, then GUILD_CREATE
			if (parsed.op === 2) {
				sendFrame(send, MOCK_READY_FRAME);
				sendFrame(send, MOCK_GUILD_CREATE_FRAME);
				return;
			}

			// REQUEST_GUILD_MEMBERS (op 8, triggered by GUILD_CREATE's
			// Member.resolveMember at guild.ts) -> GUILD_MEMBERS_CHUNK (localuser.ts gotChunk)
			if (parsed.op === 8 && parsed.d) {
				const guildId = typeof parsed.d.guild_id === "string" ? parsed.d.guild_id : MOCK_GUILD_ID;
				const nonce = typeof parsed.d.nonce === "string" ? parsed.d.nonce : "";
				const requestedIds = Array.isArray(parsed.d.user_ids)
					? (parsed.d.user_ids as string[])
					: [MOCK_USER_ID];
				const knownMembers = new Map<string, memberjson>([
					[MOCK_USER_ID, MOCK_MEMBER],
					[MOCK_BOT_USER_ID, MOCK_BOT_MEMBER],
				]);
				const found: memberjson[] = [];
				const notFound: string[] = [];
				for (const id of requestedIds) {
					const memb = knownMembers.get(id);
					if (memb) found.push(memb);
					else notFound.push(id);
				}
				sendFrame(send, {
					op: 0,
					t: "GUILD_MEMBERS_CHUNK",
					s: ++seq,
					d: {
						guild_id: guildId,
						chunk_index: 0,
						chunk_count: 1,
						nonce,
						members: found,
						not_found: notFound,
						presences: [],
					},
				});
				// Ensure #channels redraws once guild.member has settled even if the guild icon
				// was clicked before the 10ms getmembers() batch timer fired.
				sendFrame(send, {
					op: 0,
					t: "CHANNEL_UPDATE",
					s: ++seq,
					d: MOCK_CHANNEL,
				});
			}
		});

		// Setting onClose disables Playwright's default close forwarding, so the mock must
		// complete the app's close itself - without it the app's ws.close(4041) never fires
		// its close event and no reconnect path can run.
		ws.onClose((code, reason) => {
			activeSockets.delete(send);
			// A page or context already closing rejects this; nothing is left to complete.
			ws.close({code, reason}).catch(() => {});
		});
	});

	// REST + static discovery routes on http://localhost:4173
	await page.route(
		(url) => {
			if (url.origin !== MOCK_INSTANCE_ORIGIN) return false;
			const p = url.pathname;
			return (
				p === "/instances.json" ||
				p === "/custom-badges.json" ||
				p.startsWith("/.well-known/") ||
				p.startsWith("/api/") ||
				p.startsWith("/_spacebar/") ||
				p.startsWith("/embed/avatars/") ||
				(p.startsWith("/icons/") && p.endsWith(".png")) ||
				p === "/getupdates"
			);
		},
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const {pathname, searchParams} = url;
			const method = request.method().toUpperCase();

			let parsedBody: unknown = undefined;
			const rawBody = request.postData();
			if (rawBody) {
				try {
					parsedBody = JSON.parse(rawBody);
				} catch {
					parsedBody = rawBody;
				}
			}
			capturedRequests.push({
				url: request.url(),
				pathname,
				method,
				body: parsedBody,
			});

			const fulfillJson = (body: unknown, status = 200) =>
				route.fulfill({
					status,
					contentType: "application/json",
					body: JSON.stringify(body),
				});

			// 1. Instance picker discovery (src/webpage/utils/utils.ts)
			if (method === "GET" && pathname === "/instances.json") {
				return fulfillJson(MOCK_INSTANCES);
			}

			// 2. Well-known Spacebar discovery (src/webpage/utils/utils.ts)
			if (method === "GET" && pathname === "/.well-known/spacebar/client") {
				return fulfillJson(MOCK_WELL_KNOWN);
			}

			// 3. Instance ping (register.ts tosLogic / localuser.ts isPing)
			if (method === "GET" && pathname === "/api/v9/ping") {
				return fulfillJson(MOCK_PING);
			}

			// 4. Instance policies config (src/webpage/login.ts)
			if (method === "GET" && pathname === "/api/v9/policies/instance/config") {
				return fulfillJson(MOCK_POLICIES_CONFIG);
			}

			// 5. Login (src/webpage/login.ts makeLogin)
			if (method === "POST" && pathname === "/api/v9/auth/login") {
				if (handle.onLogin) {
					await handle.onLogin(route, parsedBody);
					return;
				}
				return fulfillJson(MOCK_LOGIN_RESPONSE);
			}

			// 6. Favorites settings proto sync (src/webpage/favorites.ts settings-proto sync)
			if (
				(method === "GET" || method === "PATCH") &&
				pathname === "/api/v9/users/@me/settings-proto/2/json"
			) {
				return fulfillJson(MOCK_SETTINGS_PROTO);
			}

			// 7. GIF provider discovery (src/webpage/localuser.ts)
			if (method === "GET" && pathname === "/_spacebar/api/v1/integrations/gif") {
				return fulfillJson(MOCK_GIF_INTEGRATIONS);
			}

			// 8. Custom badges (src/webpage/user.ts)
			if (method === "GET" && pathname === "/custom-badges.json") {
				return fulfillJson(MOCK_CUSTOM_BADGES);
			}

			// 9. Default user/member avatars (src/webpage/user.ts)
			if (method === "GET" && pathname.startsWith("/embed/avatars/")) {
				return route.fulfill({
					status: 200,
					contentType: "image/png",
					body: TRANSPARENT_PNG,
				});
			}

			// 9b. Guild icon (Guild.generateGuildIcon builds cdn + /icons/:id/:icon.png)
			if (method === "GET" && pathname.startsWith("/icons/")) {
				return route.fulfill({
					status: 200,
					contentType: "image/png",
					body: TRANSPARENT_PNG,
				});
			}

			// 10. Guild welcome screen (src/webpage/guild.ts)
			if (method === "GET" && /^\/api\/v9\/guilds\/[^/]+\/welcome-screen$/.test(pathname)) {
				return fulfillJson(MOCK_WELCOME_SCREEN);
			}

			// 10b. Single member lookup (Member.resolveMember -> localuser.resolvemember)
			const memberMatch = pathname.match(/^\/api\/v9\/guilds\/[^/]+\/members\/([^/]+)$/);
			if (method === "GET" && memberMatch) {
				return fulfillJson(memberMatch[1] === MOCK_BOT_USER_ID ? MOCK_BOT_MEMBER : MOCK_MEMBER);
			}

			// 11. Channel messages history (src/webpage/channel.ts putmessages)
			if (method === "GET" && /^\/api\/v9\/channels\/[^/]+\/messages$/.test(pathname)) {
				const before = searchParams.get("before");
				const around = searchParams.get("around");
				const after = searchParams.get("after");
				if (before) {
					const beforeId = BigInt(before);
					return fulfillJson(messages.filter((m) => BigInt(m.id) < beforeId));
				}
				if (around) {
					// getmessage fetches ?limit=1&around=<id> and takes json[0].
					return fulfillJson(messages.filter((m) => m.id === around));
				}
				if (after) {
					const afterId = BigInt(after);
					// grabAfter links each response element forward from the anchor, so an
					// after page must be ASCENDING (Discord ?after= semantics); the stored
					// fixture is newest-first.
					return fulfillJson(messages.filter((m) => BigInt(m.id) > afterId).reverse());
				}
				return fulfillJson(messages);
			}

			// 12. Message read-state acks (src/webpage/channel.ts & src/webpage/guild.ts)
			if (
				method === "POST" &&
				(/^\/api\/v9\/channels\/[^/]+\/messages\/[^/]+\/ack$/.test(pathname) ||
					pathname === "/api/v9/read-states/ack-bulk")
			) {
				return fulfillJson({token: null});
			}

			// 13. User profile lookup (src/webpage/user.ts profile lookup)
			const profileMatch = pathname.match(/^\/api\/v9\/users\/([^/]+)\/profile$/);
			if (method === "GET" && profileMatch) {
				const userId = profileMatch[1];
				const user = userId === MOCK_BOT_USER_ID ? MOCK_BOT_USER : MOCK_USER;
				return fulfillJson({
					user,
					connected_accounts: [],
					premium_guild_since: null,
					premium_since: null,
					mutual_guilds: [],
					mutual_friends: [],
					application: null,
					badges: [],
				});
			}

			// 14. Component / command interactions (src/webpage/interactions/compontents.ts)
			if (method === "POST" && pathname === "/api/v9/interactions") {
				if (handle.onInteractions) {
					await handle.onInteractions(route, parsedBody);
					return;
				}
				return route.fulfill({status: 204, body: ""});
			}

			// 14b. A sent message (the forward flow's send): accepted, no echo. A spec pins
			// the send from capturedRequests; nothing downstream reads the response body.
			if (method === "POST" && /^\/api\/v9\/channels\/[^/]+\/messages$/.test(pathname)) {
				return route.fulfill({status: 200, contentType: "application/json", body: "{}"});
			}

			// 14c. The composer's typing indicator (the slash popup's typing fires it; the
			// app ignores the answer).
			if (method === "POST" && /^\/api\/v9\/channels\/[^/]+\/typing$/.test(pathname)) {
				return route.fulfill({status: 204, body: ""});
			}

			// 16. Invite preview + accept (src/webpage/invite.ts page, embed.ts
			// generateInvite, utils/acceptInvite.ts).
			if (method === "GET" && /^\/api\/v9\/invites\/[^/]+$/.test(pathname)) {
				return fulfillJson(MOCK_INVITE);
			}
			if (method === "POST" && /^\/api\/v9\/invites\/[^/]+$/.test(pathname)) {
				return fulfillJson({guild: {id: MOCK_GUILD_ID}});
			}

			// 17. The guild's slash-command index (src/webpage/guild.ts getCommandsFetch).
			if (
				method === "GET" &&
				/^\/api\/v9\/guilds\/[^/]+\/application-command-index$/.test(pathname)
			) {
				return fulfillJson(MOCK_COMMAND_INDEX);
			}

			// 15. Short-rev nonce base, plain text on purpose (createMachloketNonce reads
			// res.text() and slices the first 7 chars).
			if (method === "GET" && pathname === "/getupdates") {
				return route.fulfill({status: 200, contentType: "text/plain", body: "e2e-mock"});
			}

			// Loud failure for any unmocked API / discovery route on same-origin: the abort
			// net makes the request fail, and this line names the gap in the console.
			console.error("[e2e-mock] unmocked request:", method, pathname);
			return route.abort("failed");
		},
	);

	return handle;
}
