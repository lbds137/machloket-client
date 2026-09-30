import {describe, expect, it} from "vitest";
import {captureRequests} from "../test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before the interaction code.
const {Localuser} = await import("../localuser");
const {Components} = await import("./compontents");
const {Message} = await import("../message.js");
const {Command} = await import("./commands.js");

const API = "http://dm.test/api/v9";

/**
 * A message in a channel whose owning guild is `guildId` — "@me" for a DM, a snowflake for a
 * guild. In a DM the client's owning "guild" is the "@me" pseudo-guild (direct.ts), and that id
 * must never reach the wire: the server rejects an interaction whose guild_id isn't the
 * channel's own guild, and a DM channel has none. Discord's client omits guild_id for DM
 * interactions; in a guild the real snowflake is sent and validated.
 */
function messageIn(guildId: string) {
	const headers = {"Content-type": "application/json", Authorization: "token"};
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		interNonceMap: new Map(),
		interactionNonces: new Set(),
		commandChannels: new Map(),
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
const dmMessage = () => messageIn("@me");

describe("component and command interactions in a DM", () => {
	it("a button click sends no guild_id", async () => {
		const sent = captureRequests(API + "/interactions");
		const {message} = dmMessage();
		const button = new Components(
			[{type: 2, style: 1, custom_id: "go", label: "Go"}],
			message,
		).components[0] as unknown as {clickEvent: () => Promise<void>};

		await button.clickEvent();

		expect(sent).toHaveLength(1);
		expect(sent[0]).not.toHaveProperty("guild_id");
		expect(sent[0]).toMatchObject({
			type: 3,
			channel_id: "200",
			application_id: "300",
			message_id: "500",
			session_id: "session-1",
			data: {component_type: 2, custom_id: "go"},
		});
	});

	it("a select submit sends no guild_id", async () => {
		const sent = captureRequests(API + "/interactions");
		const {message} = dmMessage();
		const select = new Components(
			[
				{
					type: 3,
					custom_id: "pick",
					options: [
						{label: "Large", value: "l", default: true},
						{label: "Small", value: "s"},
					],
				},
			],
			message,
		).components[0] as unknown as {submit: (values: string[]) => Promise<void>};

		await select.submit(["l"]);

		expect(sent).toHaveLength(1);
		expect(sent[0]).not.toHaveProperty("guild_id");
		expect(sent[0]).toMatchObject({
			type: 3,
			channel_id: "200",
			application_id: "300",
			message_id: "500",
			data: {component_type: 3, custom_id: "pick", values: ["l"]},
		});
	});

	it("a button click in a guild still sends the guild's id", async () => {
		const sent = captureRequests(API + "/interactions");
		const {message} = messageIn("1553128655016763450");
		const button = new Components(
			[{type: 2, style: 1, custom_id: "go", label: "Go"}],
			message,
		).components[0] as unknown as {clickEvent: () => Promise<void>};

		await button.clickEvent();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			guild_id: "1553128655016763450",
			type: 3,
			channel_id: "200",
		});
	});

	it("a slash command sends no guild_id", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = dmMessage();
		const command = new Command(
			{
				id: "900",
				type: 1,
				application_id: "300",
				name: "ask",
				description: "",
				dm_permission: true,
				nsfw: false,
				global_popularity_rank: 0,
				handler: 1,
				version: "1",
				options: [{type: 3, name: "msg", description: "", required: true}],
			},
			localuser,
		);
		command.state.set(channel as never, [{option: command.options[0], state: "hi"}]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).not.toHaveProperty("guild_id");
		expect(sent[0]).toMatchObject({
			type: 2,
			channel_id: "200",
			application_id: "300",
		});
	});
});
