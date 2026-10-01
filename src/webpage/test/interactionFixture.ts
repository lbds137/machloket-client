// Shared fixture for interaction-wire tests: a message in a channel whose owning guild is
// `guildId` — "@me" for a DM, a snowflake for a guild. In a DM the client's owning "guild" is
// the "@me" pseudo-guild (direct.ts), and that id must never reach the interaction wire: the
// server rejects a guild_id that isn't the channel's own guild, and a DM channel has none.
// The Object.create pattern satisfies the instanceof gates in the production getters
// (compObj.message/channel, Message.get guild/localuser/info) with only the fields the wire
// paths read; modal.test.ts builds its own session for gateway-event tests.
//
// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order, so this module loads localuser before anything else — import it first from tests.
const {Localuser} = await import("../localuser");
const {Message} = await import("../message.js");
const {I18n} = await import("../i18n");
await I18n.done;

export const API = "http://dm.test/api/v9";

export function messageIn(guildId: string) {
	const headers = {"Content-type": "application/json", Authorization: "token"};
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		interNonceMap: new Map(),
		interactionNonces: new Set(),
		commandChannels: new Map(),
		commandNonceLabels: new Map(),
		interactionIdLabels: new Map(),
		guilds: [],
		guildids: new Map([[guildId, {channels: []}]]),
		generateFavicon: () => {},
		channelids: new Map(),
		info: {api: API},
		headers,
		session_id: "session-1",
	}) as InstanceType<typeof Localuser>;
	const guild = {id: guildId};
	const channel = {
		id: "200",
		owner: guild,
		guild,
		localuser,
		info: {api: API},
		headers,
	};
	const message = Object.assign(Object.create(Message.prototype), {
		id: "500",
		flags: 0,
		author: {id: "300"},
		owner: channel,
		headers,
	}) as unknown as InstanceType<typeof Message>;
	return {localuser, channel, message};
}

export const dmMessage = () => messageIn("@me");
