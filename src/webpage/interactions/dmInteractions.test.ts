import {describe, expect, it} from "vitest";
import {captureRequests} from "../test/setup";
import {API, dmMessage, messageIn} from "../test/interactionFixture";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first); the fixture loads localuser first.
const {Components} = await import("./compontents");
const {Command} = await import("./commands.js");

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
