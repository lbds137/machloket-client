import {describe, expect, it} from "vitest";
import {captureRequests} from "../test/setup";
import {API, messageIn} from "../test/interactionFixture";
import type {commandJson as commandJsonT, commandOptionJson} from "../jsontypes.js";

// The fixture loads localuser (and I18n) first; commands.js comes after.
const {Command} = await import("./commands.js");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: styleText} = await import("../public/style.css?inline");

const commandJson = (options: commandOptionJson[]): commandJsonT => ({
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
	options,
});

/**
 * A command whose options' composer states are `states` (by option name, typed like the
 * composer stores them: strings). `run()` submits; `sent` collects the POST bodies.
 */
function commandWith(options: commandOptionJson[], states: Record<string, string>) {
	const sent = captureRequests(API + "/interactions");
	const {localuser, channel} = messageIn("@me");
	const command = new Command(commandJson(options), localuser);
	const entries = command.options
		.filter((option) => option.name in states)
		.map((option) => ({option, state: states[option.name]}));
	command.state.set(channel as never, entries);
	return {sent, run: () => command.submit(document.createElement("div"), channel as never)};
}

describe("typed slash-command options", () => {
	it("an integer option sends a JSON number", async () => {
		const {sent, run} = commandWith(
			[{type: 4, name: "count", description: "", required: true, min_value: 1, max_value: 10}],
			{count: "4"},
		);

		await run();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			type: 2,
			data: {name: "ask", options: [{name: "count", type: 4, value: 4}]},
		});
	});

	it("a number option (type 10) sends a float", async () => {
		const {sent, run} = commandWith(
			[{type: 10, name: "scale", description: "", required: true}],
			{scale: "3.5"},
		);

		await run();

		expect(sent[0]).toMatchObject({
			data: {options: [{name: "scale", type: 10, value: 3.5}]},
		});
	});

	it("a non-integer value in an integer option blocks the send", async () => {
		const {sent, run} = commandWith(
			[{type: 4, name: "count", description: "", required: true}],
			{count: "4.5"},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("an out-of-range value blocks the send", async () => {
		const {sent, run} = commandWith(
			[{type: 4, name: "count", description: "", required: true, min_value: 1}],
			{count: "0"},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("a boolean option sends a JSON boolean", async () => {
		const {sent, run} = commandWith(
			[{type: 5, name: "loud", description: "", required: true}],
			{loud: "true"},
		);

		await run();

		expect(sent[0]).toMatchObject({
			data: {options: [{name: "loud", type: 5, value: true}]},
		});
	});

	it("a required option with an empty value blocks the send", async () => {
		const {sent, run} = commandWith(
			[{type: 3, name: "msg", description: "", required: true}],
			{msg: ""},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("a required boolean blocks until it is answered", async () => {
		const {sent, run} = commandWith(
			[{type: 5, name: "loud", description: "", required: true}],
			{loud: ""},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("an answered-false boolean sends false and counts as answered", async () => {
		const {sent, run} = commandWith(
			[{type: 5, name: "loud", description: "", required: true}],
			{loud: "false"},
		);

		await run();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {options: [{name: "loud", type: 5, value: false}]},
		});
	});

	it("a value above max_value blocks the send", async () => {
		const {sent, run} = commandWith(
			[{type: 4, name: "count", description: "", required: true, max_value: 10}],
			{count: "11"},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("an empty optional option is omitted from the send", async () => {
		const {sent, run} = commandWith(
			[
				{type: 3, name: "msg", description: "", required: true},
				{type: 10, name: "scale", description: ""},
			],
			{msg: "hi", scale: ""},
		);

		await run();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {options: [{name: "msg", type: 3, value: "hi"}]},
		});
		expect((sent[0] as {data: {options: unknown[]}}).data.options).toHaveLength(1);
	});

	it("the live submit body matches the pinned wire shape EXACTLY (a slash command)", async () => {
		// Subset matching (toMatchObject) would let an extra field slip through — the
		// server's strict schema rejects those silently, so the whole body is pinned.
		// application_command mirrors the index row the server sent and its schema allows
		// it verbatim; only its presence is pinned.
		const {sent, run} = commandWith(
			[{type: 3, name: "msg", description: "", required: true}],
			{msg: "hi"},
		);
		await run();
		expect(sent[0]).toEqual({
			type: 2,
			nonce: expect.any(String),
			channel_id: "200",
			application_id: "300",
			session_id: "session-1",
			data: {
				application_command: expect.any(Object),
				attachments: [],
				id: "900",
				name: "ask",
				options: [{name: "msg", type: 3, value: "hi"}],
				type: 1,
				version: "1",
			},
		});
	});

	it("the live submit body matches the pinned wire shape EXACTLY (a nested subcommand)", async () => {
		const {localuser} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "view",
					description: "",
					options: [{type: 3, name: "name", description: "", required: true}],
				},
			]),
			localuser,
		);
		const sent = captureRequests(API + "/interactions");
		const {channel} = messageIn("@me");
		const branch = command.options[0];
		const leaf = (branch as unknown as {children: {name: string}[]}).children.find(
			(_) => _.name === "name",
		);
		command.state.set(channel as never, [
			{option: branch, state: "view"},
			{option: leaf as never, state: "alice"},
		]);
		await command.submit(document.createElement("div"), channel as never);
		expect(sent[0]).toEqual({
			type: 2,
			nonce: expect.any(String),
			channel_id: "200",
			application_id: "300",
			session_id: "session-1",
			data: {
				application_command: expect.any(Object),
				attachments: [],
				id: "900",
				name: "ask",
				options: [
					{name: "view", type: 1, options: [{name: "name", type: 3, value: "alice"}]},
				],
				type: 1,
				version: "1",
			},
		});
	});
});

describe("entity slash-command options (user, channel, role, mentionable)", () => {
	it("a user option sends the picked snowflake as a string", async () => {
		const {sent, run} = commandWith(
			[{type: 6, name: "who", description: "", required: true}],
			{who: "1553128655016763450"},
		);

		await run();

		expect(sent[0]).toMatchObject({
			data: {options: [{name: "who", type: 6, value: "1553128655016763450"}]},
		});
	});

	it("a channel option sends the picked snowflake as a string", async () => {
		const {sent, run} = commandWith(
			[{type: 7, name: "where", description: "", required: true}],
			{where: "1553780562722828434"},
		);

		await run();

		expect(sent[0]).toMatchObject({
			data: {options: [{name: "where", type: 7, value: "1553780562722828434"}]},
		});
	});

	it("role and mentionable options send snowflake strings", async () => {
		const roleRun = commandWith(
			[{type: 8, name: "role", description: "", required: true}],
			{role: "1553128655016763451"},
		);
		await roleRun.run();
		expect(roleRun.sent[0]).toMatchObject({
			data: {options: [{name: "role", type: 8, value: "1553128655016763451"}]},
		});

		const mentionRun = commandWith(
			[{type: 9, name: "target", description: "", required: true}],
			{target: "1553128655016763452"},
		);
		await mentionRun.run();
		expect(mentionRun.sent[0]).toMatchObject({
			data: {options: [{name: "target", type: 9, value: "1553128655016763452"}]},
		});
	});

	it("a typed answer that isn't a picked id blocks the send", async () => {
		const {sent, run} = commandWith(
			[{type: 6, name: "who", description: "", required: true}],
			{who: "alice"},
		);

		await expect(run()).resolves.toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("picking a candidate from the popup stores the member's id", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("1553128655016763450");
		(channel as unknown as {guild: unknown}).guild = {
			id: "1553128655016763450",
			members: [
				{
					id: "1553128655016763451",
					user: {username: "Tzurot"},
					compare: (name: string) => (name ? 1 : 0),
				},
			],
			roles: [],
			channels: [],
		};
		const command = new Command(
			commandJson([{type: 6, name: "who", description: "", required: true}]),
			localuser,
		);
		const chip = command.options[0].toHTML("", channel as never);
		// render() seeds the channel's state entries before any chip exists; mirror that.
		command.state.set(channel as never, [{option: command.options[0], state: ""}]);
		const input = chip.querySelector("input") as HTMLInputElement;
		input.value = "Tz";
		input.dispatchEvent(new KeyboardEvent("keyup", {key: "T"}));

		const candidate = searchOptions.querySelector("span") as HTMLElement;
		expect(candidate).not.toBeNull();
		candidate.click();

		expect(command.getState(command.options[0], channel as never)).toBe(
			"1553128655016763451",
		);
		// A pick empties the popup: leftover rows make the next Enter pick again instead of
		// submitting the command (the live /random stall).
		expect(searchOptions.innerHTML).toBe("");
		searchOptions.remove();
	});

	it("the @everyone role is not a candidate, but real roles are", () => {
		const {localuser, channel} = messageIn("100");
		const command = new Command(commandJson([{type: 8, name: "role", description: ""}]), localuser);
		(channel as unknown as {guild: unknown}).guild = {
			id: "100",
			members: [],
			roles: [
				{id: "100", name: "everyone"},
				{id: "101", name: "witch"},
			],
			channels: [],
		};
		const collect = command.options[0] as unknown as {
			collect: (channel: unknown) => {value: string}[];
		};

		const values = collect.collect(channel).map((_) => _.value);

		expect(values).toEqual(["101"]);
	});

	it("channel_types narrows channel candidates", () => {
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([{type: 7, name: "where", description: "", channel_types: [2]}]),
			localuser,
		);
		(channel as unknown as {guild: unknown}).guild = {
			id: "100",
			members: [],
			roles: [],
			channels: [
				{id: "1", name: "general", type: 0, visible: true},
				{id: "2", name: "voice", type: 2, visible: true},
				{id: "3", name: "hidden", type: 2, visible: false},
			],
		};
		const collect = command.options[0] as unknown as {
			collect: (channel: unknown) => {value: string}[];
		};

		expect(collect.collect(channel).map((_) => _.value)).toEqual(["2"]);
	});

	it("in a DM, only people are candidates: a role option offers nothing", () => {
		const {localuser, channel} = messageIn("@me");
		(channel as unknown as {users?: unknown}).users = [{id: "9", name: "Alice"}];
		const userCommand = new Command(commandJson([{type: 6, name: "who", description: ""}]), localuser);
		const roleCommand = new Command(commandJson([{type: 8, name: "role", description: ""}]), localuser);
		const collect = (option: unknown) =>
			(option as {collect: (channel: unknown) => {value: string}[]}).collect(channel);

		expect(collect(userCommand.options[0]).map((_) => _.value)).toEqual(["9"]);
		expect(collect(roleCommand.options[0])).toEqual([]);
	});

	it("matching goes through the member's compare, not the display text", () => {
		const {localuser, channel} = messageIn("100");
		const command = new Command(commandJson([{type: 6, name: "who", description: ""}]), localuser);
		(channel as unknown as {guild: unknown}).guild = {
			id: "100",
			members: [
				{
					id: "7",
					user: {username: "Zed"},
					// Refuses everything: if matching fell back to the display text, "Zed" would match.
					compare: () => 0,
				},
			],
			roles: [],
			channels: [],
		};
		const candidates = command.options[0] as unknown as {
			candidates: (channel: unknown, query: string) => {value: string}[];
		};

		expect(candidates.candidates(channel, "Zed")).toEqual([]);
	});
});

describe("attachment slash-command options (type 11)", () => {
	function attachmentCommand() {
		const {localuser, channel} = messageIn("100");
		(channel as unknown as {uploadFile: unknown}).uploadFile = async () => [
			{
				id: "0",
				upload_url: "http://dm.test/up/0",
				upload_filename: "77/0/kitten.png",
			},
		];
		const command = new Command(
			commandJson([{type: 11, name: "image", description: "", required: true}]),
			localuser,
		);
		return {localuser, channel, command};
	}

	it("picking a file uploads it and the submit pairs the option value with data.attachments", async () => {
		const sent = captureRequests(API + "/interactions");
		const {channel, command} = attachmentCommand();
		command.state.set(channel as never, [
			{option: command.options[0], state: ""},
		]);
		const pick = command.options[0] as unknown as {
			pick: (files: globalThis.File[], channel: unknown) => Promise<void>;
		};

		await pick.pick([new File(["png"], "kitten.png", {type: "image/png"})], channel);

		expect(command.getState(command.options[0], channel as never)).toBe("0");
		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			type: 2,
			data: {
				options: [{name: "image", type: 11, value: "0"}],
				attachments: [{id: "0", filename: "kitten.png", uploaded_filename: "77/0/kitten.png"}],
			},
		});
	});

	it("a required attachment blocks until a file is picked", async () => {
		const sent = captureRequests(API + "/interactions");
		const {channel, command} = attachmentCommand();
		command.state.set(channel as never, [
			{option: command.options[0], state: ""},
		]);

		await expect(command.submit(document.createElement("div"), channel as never)).resolves.toBe(
			false,
		);
		expect(sent).toHaveLength(0);
	});

	it("a value with no uploaded file behind it blocks the send", async () => {
		const sent = captureRequests(API + "/interactions");
		const {channel, command} = attachmentCommand();
		command.state.set(channel as never, [
			{option: command.options[0], state: "123456789012345678"},
		]);

		await expect(command.submit(document.createElement("div"), channel as never)).resolves.toBe(
			false,
		);
		expect(sent).toHaveLength(0);
	});

	it("a failed upload leaves the option empty — no half-attached state", async () => {
		const {channel, command} = attachmentCommand();
		(channel as unknown as {uploadFile: unknown}).uploadFile = async () => {
			throw new Error("attachment upload failed: 413");
		};
		command.state.set(channel as never, [
			{option: command.options[0], state: ""},
		]);
		const pick = command.options[0] as unknown as {
			pick: (files: globalThis.File[], channel: unknown) => Promise<void>;
		};

		await expect(
			pick.pick([new File(["png"], "huge.png", {type: "image/png"})], channel),
		).rejects.toThrow("413");
		expect(command.getState(command.options[0], channel as never)).toBe("");
	});

	it("two attachment options pair distinct ref ids", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("100");
		(channel as unknown as {uploadFile: unknown}).uploadFile = async (
			files: globalThis.File[],
			ids?: string[],
		) => [
			{
				id: ids?.[0] ?? "0",
				upload_url: "http://dm.test/up/" + (ids?.[0] ?? "0"),
				upload_filename: "77/" + (ids?.[0] ?? "0") + "/" + files[0].name,
			},
		];
		const command = new Command(
			commandJson([
				{type: 11, name: "before", description: "", required: true},
				{type: 11, name: "after", description: "", required: true},
			]),
			localuser,
		);
		command.state.set(channel as never, [
			{option: command.options[0], state: ""},
			{option: command.options[1], state: ""},
		]);
		const pickA = command.options[0] as unknown as {
			pick: (files: globalThis.File[], channel: unknown) => Promise<void>;
		};
		const pickB = command.options[1] as unknown as {
			pick: (files: globalThis.File[], channel: unknown) => Promise<void>;
		};

		await pickA.pick([new File(["a"], "a.png", {type: "image/png"})], channel);
		await pickB.pick([new File(["b"], "b.png", {type: "image/png"})], channel);

		const ids = [
			command.getState(command.options[0], channel as never),
			command.getState(command.options[1], channel as never),
		];
		expect(new Set(ids).size).toBe(2);
		await command.submit(document.createElement("div"), channel as never);

		const body = sent[0] as {
			data: {options: {name: string; value: string}[]; attachments: {id: string}[]};
		};
		expect(body.data.options.map((_) => _.value).sort()).toEqual([...ids].sort());
		expect(body.data.attachments.map((_) => _.id).sort()).toEqual([...ids].sort());
	});
});

describe("context-menu commands (types 2 and 3)", () => {
	function contextCommand(type: 2 | 3) {
		const {localuser, channel, message} = messageIn("100");
		const command = new Command(
			{
				id: "950",
				type,
				application_id: "300",
				name: type === 3 ? "Inspect Message" : "Inspect User",
				description: "",
				dm_permission: true,
				nsfw: false,
				global_popularity_rank: 0,
				handler: 1,
				version: "1",
			},
			localuser,
		);
		return {localuser, channel, message, command};
	}

	it("a message context-menu invocation sends type 2 with target_id and no options", async () => {
		const sent = captureRequests(API + "/interactions");
		const {channel, message, command} = contextCommand(3);

		await command.submitContext(message.id, channel as never);

		expect(sent).toHaveLength(1);
		const body = sent[0] as {data: Record<string, unknown>};
		expect(body.data).toMatchObject({
			id: "950",
			name: "Inspect Message",
			type: 3,
			target_id: "500",
		});
		expect(body.data).not.toHaveProperty("options");
	});

	it("a refused context-menu invocation reports and keeps nothing sent", async () => {
		captureRequests(
			API + "/interactions",
			() =>
				new Response(JSON.stringify({message: "Unknown target"}), {
					status: 404,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const {channel, message, command} = contextCommand(3);

		await expect(
			command.submitContext(message.id, channel as never),
		).resolves.toBe(false);
	});
});

describe("subcommand options (types 1 and 2)", () => {
	it("a picked subcommand nests its leaf options", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "view",
					description: "",
					options: [{type: 3, name: "name", description: "", required: true}],
				},
			]),
			localuser,
		);
		command.state.set(channel as never, [
			{option: command.options[0], state: "view"},
			{
				option: (command.options[0] as unknown as {children: unknown[]}).children[0] as never,
				state: "Zed",
			},
		]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {
				options: [{name: "view", type: 1, options: [{name: "name", type: 3, value: "Zed"}]}],
			},
		});
	});

	it("a command whose subcommand is unpicked blocks the send", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{type: 1, name: "view", description: "", options: []},
			]),
			localuser,
		);
		command.state.set(channel as never, [{option: command.options[0], state: ""}]);

		await expect(command.submit(document.createElement("div"), channel as never)).resolves.toBe(
			false,
		);
		expect(sent).toHaveLength(0);
	});

	it("a subcommand group nests group, subcommand and leaves", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 2,
					name: "apikey",
					description: "",
					options: [
						{
							type: 1,
							name: "set",
							description: "",
							options: [{type: 3, name: "key", description: "", required: true}],
						},
					],
				},
			]),
			localuser,
		);
		const sub = (command.options[0] as unknown as {children: unknown[]}).children[0];
		const leaf = (sub as unknown as {children: unknown[]}).children[0];
		command.state.set(channel as never, [
			{option: command.options[0], state: "apikey/set"},
			{option: leaf as never, state: "abc123"},
		]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {
				options: [
					{
						name: "apikey",
						type: 2,
						options: [{name: "set", type: 1, options: [{name: "key", type: 3, value: "abc123"}]}],
					},
				],
			},
		});
	});

	it("a required leaf under the picked subcommand blocks when empty", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "view",
					description: "",
					options: [{type: 3, name: "name", description: "", required: true}],
				},
			]),
			localuser,
		);
		command.state.set(channel as never, [
			{option: command.options[0], state: "view"},
			{
				option: (command.options[0] as unknown as {children: unknown[]}).children[0] as never,
				state: "",
			},
		]);

		await expect(command.submit(document.createElement("div"), channel as never)).resolves.toBe(
			false,
		);
		expect(sent).toHaveLength(0);
	});

	it("an optional leaf under the picked subcommand is omitted from its nested options", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "view",
					description: "",
					options: [
						{type: 3, name: "name", description: "", required: true},
						{type: 3, name: "tag", description: ""},
					],
				},
			]),
			localuser,
		);
		const children = (command.options[0] as unknown as {children: unknown[]}).children;
		command.state.set(channel as never, [
			{option: command.options[0], state: "view"},
			{option: children[0] as never, state: "Zed"},
			{option: children[1] as never, state: ""},
		]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect((sent[0] as {data: {options: unknown[]}}).data.options).toEqual([
			{name: "view", type: 1, options: [{value: "Zed", type: 3, name: "name"}]},
		]);
	});

	it("a sub of the SECOND group wires that group's name", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{
					type: 2,
					name: "persona",
					description: "",
					options: [
						{type: 1, name: "set", description: "", options: [{type: 3, name: "a", description: "", required: true}]},
					],
				},
				{
					type: 2,
					name: "locale",
					description: "",
					options: [
						{type: 1, name: "set", description: "", options: [{type: 3, name: "b", description: "", required: true}]},
					],
				},
			]),
			localuser,
		);
		const locale = command.options[1];
		const subLeaf = (locale as unknown as {children: unknown[]}).children[0] as unknown as {
			children: unknown[];
		};
		command.state.set(channel as never, [
			{option: command.options[0], state: "locale/set"},
			{option: subLeaf.children[0] as never, state: "en-GB"},
		]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {
				options: [
					{
						name: "locale",
						type: 2,
						options: [{name: "set", type: 1, options: [{name: "b", value: "en-GB"}]}],
					},
				],
			},
		});
	});

	it("picking the SECOND sibling subcommand resolves its own leaves", async () => {
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("@me");
		const command = new Command(
			commandJson([
				{type: 1, name: "view", description: "", options: [{type: 3, name: "name", description: "", required: true}]},
				{type: 1, name: "delete", description: "", options: [{type: 3, name: "id", description: "", required: true}]},
			]),
			localuser,
		);
		const delLeaves = (command.options[1] as unknown as {children: unknown[]}).children;
		command.state.set(channel as never, [
			{option: command.options[0], state: "delete"},
			{option: delLeaves[0] as never, state: "42"},
		]);

		await command.submit(document.createElement("div"), channel as never);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			data: {options: [{name: "delete", type: 1, options: [{name: "id", value: "42"}]}]},
		});
	});

	it("the live flow works: render offers the branch choice, leaves reach state, collect keeps them", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "view", description: "", options: [{type: 3, name: "name", description: "", required: true}]},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			// The branch chip offers its popup on insert — no auto-pick of the first branch.
			await new Promise((r) => setTimeout(r, 0));
			expect(command.getState(command.options[0], channel as never)).toBe("");
			expect(html.querySelectorAll(".commandinput")).toHaveLength(1);
			expect(searchOptions.querySelectorAll("span").length).toBeGreaterThan(0);

			const viewRow = [...searchOptions.querySelectorAll("span")].find(
				(s) => s.textContent === "view",
			) as HTMLElement;
			viewRow.click();
			expect(command.getState(command.options[0], channel as never)).toBe("view");

		const chips = [...html.querySelectorAll(".commandinput")];
		expect(chips.length).toBe(2); // the branch chip and the required leaf's
		expect(chips[1].getAttribute("commandName")).toBe("name");
		expect(chips[1].classList.contains("commandHidden")).toBe(false);
		const leafInput = chips[1].querySelector("input") as HTMLInputElement;
		leafInput.value = "Zed";
		leafInput.dispatchEvent(new KeyboardEvent("keyup", {key: "d"}));

		expect(command.getState(command.options[0], channel as never)).toBe("view");
		const leaf = (command.options[0] as unknown as {children: unknown[]}).children[0];
		expect(command.getState(leaf as never, channel as never)).toBe("Zed");

		// collect() rebuilds state from the DOM; the leaf entry must survive it.
		command.collect(html, channel as never);
		expect(command.getState(leaf as never, channel as never)).toBe("Zed");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("an argument-less branch shows its picked name and submits with no leaves", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const sent = captureRequests(API + "/interactions");
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([{type: 1, name: "browse", description: "", options: []}]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const browseRow = [...searchOptions.querySelectorAll("span")].find(
				(s) => s.textContent === "browse",
			) as HTMLElement;
			browseRow.click();

			const branchInput = html.querySelector(".commandinput input") as HTMLInputElement;
			expect(branchInput.value).toBe("browse");
			expect(html.querySelectorAll(".commandinput")).toHaveLength(1);

			await command.submit(html, channel as never);
			expect(sent).toHaveLength(1);
			expect(sent[0]).toMatchObject({
				data: {options: [{name: "browse", type: 1, options: []}]},
			});
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a refused interaction POST keeps the command and shows the error", async () => {
		captureRequests(
			API + "/interactions",
			() =>
				new Response(JSON.stringify({code: 0, message: "Gateway unavailable"}), {
					status: 502,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([{type: 3, name: "msg", description: "", required: true}]),
			localuser,
		);
		command.state.set(channel as never, [
			{option: command.options[0], state: "hello"},
		]);
		const html = document.createElement("div");

		await expect(command.submit(html, channel as never)).resolves.toBe(false);

		// The command stays as it was: a retry should resend the same payload.
		expect(command.state.get(channel as never)).toBeTruthy();
		const retry = captureRequests(API + "/interactions");
		await expect(command.submit(html, channel as never)).resolves.toBe(true);
		expect(retry).toHaveLength(1);
	});

	it("a command with only optional options reveals no field; the popup previews the inventory", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 3, name: "message", description: "The text to send"},
				{type: 3, name: "tag", description: "A tag"},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			// The preview opens on a microtask: startCommand/render run inside popup clicks,
			// whose own handler clears the popup after the callback.
			await new Promise((r) => setTimeout(r, 0));

			// No field is auto-revealed: optional fields wait for an explicit pick.
			const chips = [...html.querySelectorAll(".commandinput")];
			expect(chips).toHaveLength(2);
			expect(chips.every((c) => c.classList.contains("commandHidden"))).toBe(true);
			expect(document.activeElement).not.toBe(chips[0].querySelector("input"));

			// The popup lists both options, marked and described, alphabetically.
			const rows = [...searchOptions.children].map((c) => c.textContent || "");
			expect(rows).toHaveLength(2);
			expect(rows[0]).toContain("message");
			expect(rows[0]).toContain("The text to send");
			expect(rows[0]).toContain("optional");
			expect(rows[1]).toContain("tag");
			expect(rows[1]).toContain("optional");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a required option behind an optional one is the field that shows", async () => {
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 3, name: "tag", description: ""},
				{type: 3, name: "message", description: "", required: true},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = [...html.querySelectorAll(".commandinput")];
			expect(chips[0].classList.contains("commandHidden")).toBe(true); // optional waits
			expect(chips[1].classList.contains("commandHidden")).toBe(false); // required shows
			expect(document.activeElement).toBe(chips[1].querySelector("input"));
		} finally {
			html.remove();
		}
	});

	it("re-picking a branch from its popup swaps the branch and its leaves", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "view", description: "", options: [{type: 3, name: "name", description: "", required: true}]},
				{type: 1, name: "delete", description: "", options: [{type: 3, name: "id", description: "", required: true}]},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			// No auto-pick: the popup offers the choice, the user picks view first.
			expect(command.getState(command.options[0], channel as never)).toBe("");
			const viewRow = [...searchOptions.querySelectorAll("span")].find(
				(s) => s.textContent === "view",
			) as HTMLElement;
			viewRow.click();
			expect(command.getState(command.options[0], channel as never)).toBe("view");

			// Re-pick: type into the branch input, choose delete from the popup.
			const branchInput = html.querySelector(".commandinput input") as HTMLInputElement;
			branchInput.focus();
			branchInput.value = "del";
			branchInput.dispatchEvent(new KeyboardEvent("keyup", {key: "l"}));
			const candidate = searchOptions.querySelector("span") as HTMLElement;
			expect(candidate).not.toBeNull();
			candidate.click();

			expect(command.getState(command.options[0], channel as never)).toBe("delete");
			const delLeaves = (command.options[1] as unknown as {children: unknown[]}).children;
			const idChip = [...html.querySelectorAll(".commandinput")].find(
				(c) => c.getAttribute("commandName") === "id",
			) as HTMLElement;
			// The re-pick resets disclosure: only the new branch's required leaf shows.
			expect(idChip.classList.contains("commandHidden")).toBe(false);
			const idInput = idChip.querySelector("input") as HTMLInputElement;
			expect(idInput).toBeTruthy();
			idInput.value = "42";
			idInput.dispatchEvent(new KeyboardEvent("keyup", {key: "2"}));

			const sent = captureRequests(API + "/interactions");
			await command.submit(html, channel as never);
			expect(sent).toHaveLength(1);
			expect(sent[0]).toMatchObject({
				data: {options: [{name: "delete", type: 1, options: [{name: "id", value: "42"}]}]},
			});
			expect(delLeaves).toBeTruthy();
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});
});

describe("progressive composer model", () => {
	function flatCommand(options: commandOptionJson[]) {
		const {localuser, channel} = messageIn("100");
		const command = new Command(commandJson(options), localuser);
		return {channel, command, localuser};
	}

	it("renders only the first required option; the rest wait hidden", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 5, name: "incognito", description: ""},
			{type: 3, name: "tag", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = [...html.querySelectorAll(".commandinput")];
			expect(chips).toHaveLength(3);
			const visible = chips.filter((c) => !c.classList.contains("commandHidden"));
			expect(visible).toHaveLength(1);
			expect(visible[0].getAttribute("commandName")).toBe("message");
			expect(document.activeElement).toBe(visible[0].querySelector("input"));
			// The app stylesheet's own .commandinput rule is display:inline-flex !important —
			// the hidden rule must actually win the cascade, not just carry the class.
			const style = document.createElement("style");
			style.textContent = styleText;
			document.head.append(style);
			try {
				expect(getComputedStyle(chips[1]).display).toBe("none");
				expect(getComputedStyle(chips[0]).display).not.toBe("none");
			} finally {
				style.remove();
			}
		} finally {
			html.remove();
		}
	});

	it("reveals the next REQUIRED option as each fills; optionals never auto-reveal", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 5, name: "incognito", description: ""},
			{type: 3, name: "tag", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = () => [...html.querySelectorAll(".commandinput")];

			const message = chips()[0].querySelector("input") as HTMLInputElement;
			message.value = "hello";
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "o"}));
			// Filling the only required option reveals no optional field — Discord keeps those
			// behind the option popup until they are picked.
			expect(chips()[1].classList.contains("commandHidden")).toBe(true);
			expect(chips()[2].classList.contains("commandHidden")).toBe(true);
		} finally {
			html.remove();
		}
	});

	it("an answered-false boolean still counts as filled", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 5, name: "incognito", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = () => [...html.querySelectorAll(".commandinput")];
			const message = chips()[0].querySelector("input") as HTMLInputElement;
			message.value = "hello";
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "o"}));

			// The optional field joins only by an explicit pick: reveal it as the popup would.
			chips()[1].classList.remove("commandHidden");
			// Click twice: checked → true, unchecked → false. False is still an answer.
			const box = chips()[1].querySelector("input") as HTMLInputElement;
			box.click();
			box.click();

			expect(command.getState(command.options[1], channel as never)).toBe("false");
		} finally {
			html.remove();
		}
	});

	it("a required error reveals the hidden required option it names", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "first", description: "", required: true},
			{type: 3, name: "second", description: "", required: true},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = [...html.querySelectorAll(".commandinput")];
			expect(chips[1].classList.contains("commandHidden")).toBe(true);

			const first = chips[0].querySelector("input") as HTMLInputElement;
			first.value = "done";
			first.dispatchEvent(new KeyboardEvent("keyup", {key: "e"}));

			await expect(command.submit(html, channel as never)).resolves.toBe(false);
			// The submit's complaint about `second` brings its chip into view.
			expect(chips[1].classList.contains("commandHidden")).toBe(false);
		} finally {
			html.remove();
		}
	});

	it("backspace on the empty first chip exits command mode entirely", async () => {
		const {Channel} = await import("../channel");
		const {localuser} = messageIn("100");
		const typebox = document.createElement("div");
		typebox.id = "typebox";
		(typebox as unknown as {markdown: unknown}).markdown = {
			boxEnabled: false,
			boxupdate: () => {},
		};
		document.body.append(typebox);
		const chan = Object.assign(Object.create(Channel.prototype), {
			id: "200",
			// Channel's guild/localuser/info/headers all resolve through its owner; only
			// plain fields go here directly.
			owner: {id: "100", localuser, info: {api: API}, headers: {}},
		});
		const command = new Command(
			commandJson([{type: 3, name: "message", description: "", required: true}]),
			localuser,
		);
		try {
			command.render(typebox, chan as never);
			chan.curCommand = command;

			const input = typebox.querySelector(".commandinput input") as HTMLInputElement;
			input.dispatchEvent(new KeyboardEvent("keydown", {key: "Backspace"}));

			expect(typebox.innerHTML).toBe("");
			expect(chan.curCommand).toBeUndefined();
			// A later start of the same command begins clean, not on stale option state.
			expect(command.state.get(chan as never)).toBeUndefined();
		} finally {
			typebox.remove();
		}
	});

	it("typing a character into the empty first field does NOT exit command mode", async () => {
		const {Channel} = await import("../channel");
		const {localuser} = messageIn("100");
		const typebox = document.createElement("div");
		typebox.id = "typebox";
		(typebox as unknown as {markdown: unknown}).markdown = {
			boxEnabled: false,
			boxupdate: () => {},
		};
		document.body.append(typebox);
		const chan = Object.assign(Object.create(Channel.prototype), {
			id: "200",
			owner: {id: "100", localuser, info: {api: API}, headers: {}},
		});
		const command = new Command(
			commandJson([{type: 3, name: "message", description: "", required: true}]),
			localuser,
		);
		try {
			command.render(typebox, chan as never);
			chan.curCommand = command;

			const input = typebox.querySelector(".commandinput input") as HTMLInputElement;
			input.dispatchEvent(new KeyboardEvent("keydown", {key: "h"}));

			expect(typebox.querySelector(".commandFront")).toBeTruthy();
			expect(chan.curCommand).toBe(command);
		} finally {
			typebox.remove();
		}
	});

	it("backspace on a later chip removes only that chip", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 3, name: "tag", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = [...html.querySelectorAll(".commandinput")];
			const message = chips[0].querySelector("input") as HTMLInputElement;
			message.value = "hello";
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "o"}));

			const tag = chips[1].querySelector("input") as HTMLInputElement;
			tag.dispatchEvent(new KeyboardEvent("keydown", {key: "Backspace"}));

			expect(html.querySelectorAll(".commandinput")).toHaveLength(1);
			expect(html.querySelector(".commandFront")).toBeTruthy();
		} finally {
			html.remove();
		}
	});

	it("a chain of required options reveals one at a time", async () => {
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 3, name: "name", description: "", required: true},
			{type: 3, name: "tag", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const chips = () => [...html.querySelectorAll(".commandinput")];
			expect(chips()[1].classList.contains("commandHidden")).toBe(true);

			const message = chips()[0].querySelector("input") as HTMLInputElement;
			message.value = "hello";
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "o"}));
			expect(chips()[1].classList.contains("commandHidden")).toBe(false);
			expect(chips()[2].classList.contains("commandHidden")).toBe(true);

			const name = chips()[1].querySelector("input") as HTMLInputElement;
			name.value = "alice";
			name.dispatchEvent(new KeyboardEvent("keyup", {key: "a"}));
			// The last required filled reveals no optional field.
			expect(chips()[2].classList.contains("commandHidden")).toBe(true);
		} finally {
			html.remove();
		}
	});

	it("typing an option's name with a colon inserts that field inline", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command} = flatCommand([{type: 3, name: "query", description: ""}]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const node = html.lastChild as Text;
			expect(node).toBeInstanceOf(Text); // the caret's home when no field is revealed

			node.textContent = "query:";
			command.collect(html, channel as never, node as Text); // the keyup path

			const chip = html.querySelector(
				".commandinput[commandName='query']",
			) as HTMLElement;
			expect(chip.classList.contains("commandHidden")).toBe(false);
			expect(node.textContent).toBe(""); // the typed name became the field, not text
			expect(document.activeElement).toBe(chip.querySelector("input"));
			expect(searchOptions.childElementCount).toBe(0); // the popup stands down
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("stepping past the focused field offers the rest: required first, then optionals", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command} = flatCommand([
			{type: 3, name: "tag", description: "A tag"},
			{type: 3, name: "message", description: "The text", required: true},
			{type: 3, name: "name", description: "Whose", required: true},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const message = html.querySelector(
				".commandinput[commandName='message'] input",
			) as HTMLInputElement;
			// ArrowRight at the field's end steps the caret out to the trailing node.
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowRight"}));

			const rows = [...searchOptions.children].map((c) => c.textContent || "");
			expect(rows).toHaveLength(2);
			// The hidden required option outranks the optional one; both carry their marks.
			expect(rows[0]).toContain("name");
			expect(rows[0]).toContain("required");
			expect(rows[1]).toContain("tag");
			expect(rows[1]).toContain("optional");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("picking an option from the popup reveals the hidden chip once, not a duplicate", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command} = flatCommand([{type: 3, name: "query", description: ""}]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const row = [...searchOptions.children].find((c) =>
				(c.textContent || "").includes("query"),
			) as HTMLElement;
			expect(row).toBeTruthy();
			row.click();

			const chips = html.querySelectorAll(".commandinput[commandName='query']");
			expect(chips).toHaveLength(1);
			expect((chips[0] as HTMLElement).classList.contains("commandHidden")).toBe(false);
			expect(document.activeElement).toBe(chips[0].querySelector("input"));
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("an optional leaf of the picked branch previews in the popup, not as an eager field", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "browse",
					description: "",
					options: [{type: 3, name: "query", description: "Search text"}],
				},
				{
					type: 1,
					name: "view",
					description: "",
					options: [{type: 3, name: "name", description: "", required: true}],
				},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			// The branch chip offers its choice on insert; pick browse.
			const browseRow = [...searchOptions.children].find(
				(c) => c.textContent === "browse",
			) as HTMLElement;
			expect(browseRow).toBeTruthy();
			browseRow.click();
			await new Promise((r) => setTimeout(r, 0));

			const query = html.querySelector(".commandinput[commandName='query']") as HTMLElement;
			expect(query.classList.contains("commandHidden")).toBe(true);
			const row = [...searchOptions.children].find((c) =>
				(c.textContent || "").includes("query"),
			) as HTMLElement;
			expect(row).toBeTruthy();
			expect(row.textContent).toContain("Search text");
			expect(row.textContent).toContain("optional");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("Escape does not reopen the option popup on the same keyup", async () => {
		const {Channel} = await import("../channel");
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const typebox = document.createElement("div");
		typebox.id = "typebox";
		(typebox as unknown as {markdown: unknown}).markdown = {
			boxEnabled: false,
			boxupdate: () => {},
		};
		document.body.append(typebox);
		const {localuser} = messageIn("100");
		const chan = Object.assign(Object.create(Channel.prototype), {
			id: "200",
			owner: {id: "100", localuser, info: {api: API}, headers: {}},
		});
		(localuser as unknown as {channelfocus: unknown}).channelfocus = chan;
		const command = new Command(
			commandJson([{type: 3, name: "query", description: ""}]),
			localuser,
		);
		try {
			chan.startCommand(command);
			await new Promise((r) => setTimeout(r, 0));
			expect(searchOptions.childElementCount).toBeGreaterThan(0);

			// The caret sits inside the trailing text node with typed text…
			const node = typebox.lastChild as Text;
			node.textContent = "q";
			const selection = window.getSelection() as Selection;
			const range = document.createRange();
			range.setStart(node, 1);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
			// …handleEnter's Escape branch clears the popup…
			searchOptions.replaceChildren();
			// …and the command's own keyup watcher must not re-offer it.
			typebox.dispatchEvent(new KeyboardEvent("keyup", {key: "Escape"}));

			expect(searchOptions.childElementCount).toBe(0);
		} finally {
			typebox.remove();
			searchOptions.remove();
		}
	});

	it("Enter runs an optional-only command; Tab still inserts the highlighted option", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command, localuser} = flatCommand([
			{type: 3, name: "query", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			expect(searchOptions.childElementCount).toBeGreaterThan(0); // preview is open

			// Nothing typed: Enter falls through to submit — the preview is a menu, not a gate.
			expect(localuser.keyup(new KeyboardEvent("keyup", {key: "Enter"}))).toBe(false);
			// Tab commits the highlighted row for keyboard-only picking.
			expect(localuser.keyup(new KeyboardEvent("keyup", {key: "Tab"}))).toBe(true);
			const chip = html.querySelector(
				".commandinput[commandName='query']",
			) as HTMLElement;
			expect(chip.classList.contains("commandHidden")).toBe(false);
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("colon-commit leaves no typed text behind in the command state", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command} = flatCommand([{type: 3, name: "query", description: ""}]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const node = html.lastChild as Text;
			node.textContent = "query:";
			command.collect(html, channel as never, node);

			const states = command.state.get(channel as never) as unknown[];
			// Compare the loose strings only: the array's option entries hold BigInts that
			// vitest's browser reporter cannot serialize into a failure diff.
			expect(states.filter((s) => typeof s === "string")).not.toContain("query:");
			// …and a later re-render materializes no ghost text node.
			command.render(html, channel as never);
			expect(html.textContent).not.toContain("query:");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a backspaced field comes back on its name — the rebuild path of the inline insert", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {channel, command} = flatCommand([
			{type: 3, name: "message", description: "", required: true},
			{type: 3, name: "query", description: ""},
		]);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			// Step out of the required field to the trailing node, then ask for the optional
			// one by name — its hidden chip reveals.
			const message = html.querySelector(
				".commandinput[commandName='message'] input",
			) as HTMLInputElement;
			message.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowRight"}));
			const node = message.closest(".commandinput")!.nextSibling as Text;
			node.textContent = "query:";
			command.collect(html, channel as never, node);
			const chip = html.querySelector(
				".commandinput[commandName='query']",
			) as HTMLElement;
			expect(chip.classList.contains("commandHidden")).toBe(false);

			// Backspace the field away from its own empty input (it isn't the first chip, so
			// only the chip goes), then ask for it by name again — bare, without the colon.
			const input = chip.querySelector("input") as HTMLInputElement;
			input.dispatchEvent(new KeyboardEvent("keydown", {key: "Backspace"}));
			expect(html.querySelector(".commandinput[commandName='query']")).toBeNull();
			node.textContent = "query";
			command.collect(html, channel as never, node);

			const rebuilt = html.querySelectorAll(".commandinput[commandName='query']");
			expect(rebuilt).toHaveLength(1);
			expect((rebuilt[0] as HTMLElement).classList.contains("commandHidden")).toBe(false);
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("prePick starts a command with its branch chosen and leaves rendered", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "browse",
					description: "",
					options: [{type: 3, name: "query", description: ""}],
				},
				{
					type: 1,
					name: "view",
					description: "",
					options: [{type: 3, name: "name", description: "", required: true}],
				},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			// Pre-pick BEFORE the branch chip's offer microtask flushes — the picker's
			// real ordering — so the guard is what keeps the offer suppressed after it.
			command.prePick(channel as never, "view");
			await new Promise((r) => setTimeout(r, 0));

			const branch = command.options[0];
			expect(command.getState(branch, channel as never)).toBe("view");
			// The branch chip shows the pick…
			const chip = html.querySelector(".commandinput") as HTMLElement;
			expect((chip.querySelector("input") as HTMLInputElement).value).toBe("view");
			// …the offer microtask did NOT clear it or open the branch popup…
			expect(searchOptions.childElementCount).toBe(0);
			// …and view's required leaf renders revealed and focused.
			const name = html.querySelector(
				".commandinput[commandName='name']",
			) as HTMLElement;
			expect(name.classList.contains("commandHidden")).toBe(false);
			expect(document.activeElement).toBe(name.querySelector("input"));
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("the branch popup offers subcommands in alphabetical order", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "view", description: "", options: []},
				{type: 1, name: "browse", description: "", options: []},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			// The popup prepends rows as it renders: the alphabetically FIRST branch must be
			// the one at the top (the list used to read Z-A).
			const rows = [...searchOptions.children].map((c) => c.textContent);
			expect(rows).toEqual(["browse", "view"]);
			// …and the keyboard selection starts on that top row — Enter commits what the
			// user is looking at (Discord), not the bottom of the list.
			const selected = searchOptions.querySelector("span.selected") as HTMLElement;
			expect(selected.textContent).toBe("browse");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("the picked branch's required leaf reveals even when another branch reuses its name", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "browse",
					description: "",
					options: [{type: 3, name: "limit", description: ""}],
				},
				{
					type: 1,
					name: "view",
					description: "",
					options: [
						{type: 3, name: "count", description: "", required: true},
						{type: 3, name: "limit", description: "", required: true},
					],
				},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const viewRow = [...searchOptions.children].find(
				(c) => c.textContent === "view",
			) as HTMLElement;
			viewRow.click();
			await new Promise((r) => setTimeout(r, 0));

			const count = html.querySelector(
				".commandinput[commandName='count'] input",
			) as HTMLInputElement;
			count.value = "5";
			count.dispatchEvent(new KeyboardEvent("keyup", {key: "5"}));

			// view's required `limit` must reveal — not be shadowed by browse's optional one.
			const limit = html.querySelector(".commandinput[commandName='limit']") as HTMLElement;
			expect(limit.classList.contains("commandHidden")).toBe(false);
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a channel round-trip keeps a picked branch's filled leaf values", async () => {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{
					type: 1,
					name: "view",
					description: "",
					options: [
						{type: 3, name: "count", description: "", required: true},
						{type: 3, name: "limit", description: "", required: true},
					],
				},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const viewRow = [...searchOptions.children].find(
				(c) => c.textContent === "view",
			) as HTMLElement;
			viewRow.click();
			await new Promise((r) => setTimeout(r, 0));

			const count = html.querySelector(
				".commandinput[commandName='count'] input",
			) as HTMLInputElement;
			count.value = "5";
			count.dispatchEvent(new KeyboardEvent("keyup", {key: "5"}));

			// The re-render a channel switch performs keeps what was typed.
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const branch = command.options[0] as unknown as {
				children: {name: string; required: boolean}[];
			};
			const countOption = branch.children.find((_) => _.name === "count");
			expect(command.getState(countOption as never, channel as never)).toBe("5");
			const countChip = html.querySelector(
				".commandinput[commandName='count']",
			) as HTMLElement;
			expect(countChip.classList.contains("commandHidden")).toBe(false);
			expect((countChip.querySelector("input") as HTMLInputElement).value).toBe("5");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});
});

describe("keyboard and sequence regressions (GLM-week audit)", () => {
	/** A popup host, the way the app's #searchOptions exists for MDSearchOptions. */
	function popupHost() {
		const searchOptions = document.createElement("div");
		searchOptions.id = "searchOptions";
		document.body.append(searchOptions);
		return searchOptions;
	}
	/** One keystroke the way the browser delivers it: the chip input's own keyup, then the
	 * typebox's bubbled handler (index.ts runs localuser.handleKeyUp). */
	function key(input: HTMLInputElement, localuser: {handleKeyUp: (e: KeyboardEvent) => boolean}, k: string) {
		input.dispatchEvent(new KeyboardEvent("keyup", {key: k}));
		return localuser.handleKeyUp(new KeyboardEvent("keyup", {key: k}));
	}

	it("a command mixing a top-level subcommand and a group wires the PICKED branch's shape", async () => {
		const options: commandOptionJson[] = [
			{type: 1, name: "plain", description: ""},
			{
				type: 2,
				name: "grp",
				description: "",
				options: [{type: 1, name: "s", description: ""}],
			},
		];
		for (const [order, picked, wire] of [
			[options, "grp/s", {name: "grp", type: 2, options: [{name: "s", type: 1, options: []}]}],
			[[...options].reverse(), "plain", {name: "plain", type: 1, options: []}],
		] as const) {
			const sent = captureRequests(API + "/interactions");
			const {localuser, channel} = messageIn("@me");
			const command = new Command(commandJson([...order]), localuser);
			command.state.set(channel as never, [{option: command.options[0], state: picked}]);
			await command.submit(document.createElement("div"), channel as never);
			expect(sent).toHaveLength(1);
			expect((sent[0] as {data: {options: unknown}}).data.options).toEqual([wire]);
		}
	});

	it("an entity pick survives the Enter that sends: the id stays and Enter reaches submit", async () => {
		const searchOptions = popupHost();
		const {localuser, channel} = messageIn("1553128655016763450");
		(channel as unknown as {guild: unknown}).guild = {
			id: "1553128655016763450",
			members: [
				{id: "1553128655016763451", user: {username: "Tzurot"}, compare: (n: string) => (n ? 1 : 0)},
			],
			roles: [],
			channels: [],
		};
		const command = new Command(
			commandJson([{type: 6, name: "who", description: "", required: true}]),
			localuser,
		);
		const chip = command.options[0].toHTML("", channel as never);
		command.state.set(channel as never, [{option: command.options[0], state: ""}]);
		const input = chip.querySelector("input") as HTMLInputElement;
		try {
			input.value = "Tz";
			key(input, localuser, "z");
			// Enter picks the highlighted row (focus stays in the input)…
			expect(key(input, localuser, "Enter")).toBe(true);
			expect(command.getState(command.options[0], channel as never)).toBe("1553128655016763451");
			expect(input.value).toBe("@Tzurot");
			// …and the NEXT Enter is the send: nothing re-picks, the id is intact.
			expect(key(input, localuser, "Enter")).toBe(false);
			expect(command.getState(command.options[0], channel as never)).toBe("1553128655016763451");
			expect(searchOptions.childElementCount).toBe(0);
		} finally {
			searchOptions.remove();
		}
	});

	it("arrow keys move the branch popup's selection; Enter picks the selected row", async () => {
		const searchOptions = popupHost();
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "a", description: ""},
				{type: 1, name: "b", description: ""},
				{type: 1, name: "c", description: ""},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const input = html.querySelector(".commandinput input") as HTMLInputElement;
			// Rows render a, b, c top-down with the top selected; two downs land on c.
			key(input, localuser, "ArrowDown");
			key(input, localuser, "ArrowDown");
			key(input, localuser, "Enter");
			expect(command.getState(command.options[0], channel as never)).toBe("c");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a picked branch survives the Enter that sends", async () => {
		const searchOptions = popupHost();
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "browse", description: ""},
				{type: 1, name: "bump", description: ""},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			await new Promise((r) => setTimeout(r, 0));
			const input = html.querySelector(".commandinput input") as HTMLInputElement;
			expect(key(input, localuser, "Enter")).toBe(true);
			expect(command.getState(command.options[0], channel as never)).toBe("browse");
			await new Promise((r) => setTimeout(r, 0));
			// The pick re-rendered nothing to choose: the next Enter falls through to submit.
			expect(key(input, localuser, "Enter")).toBe(false);
			expect(command.getState(command.options[0], channel as never)).toBe("browse");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("a branch chosen from the picker's '/name sub' row survives the Enter that sends", async () => {
		const searchOptions = popupHost();
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 1, name: "browse", description: ""},
				{type: 1, name: "bump", description: ""},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			command.prePick(channel as never, "browse");
			await new Promise((r) => setTimeout(r, 0));
			const input = html.querySelector(".commandinput input") as HTMLInputElement;
			expect(key(input, localuser, "Enter")).toBe(false);
			expect(searchOptions.childElementCount).toBe(0);
			expect(command.getState(command.options[0], channel as never)).toBe("browse");
		} finally {
			html.remove();
			searchOptions.remove();
		}
	});

	it("each keystroke in a filled field reveals nothing more; the NEXT field waits for its turn", async () => {
		const {localuser, channel} = messageIn("100");
		const command = new Command(
			commandJson([
				{type: 3, name: "a", description: "", required: true},
				{type: 3, name: "b", description: "", required: true},
				{type: 3, name: "c", description: "", required: true},
			]),
			localuser,
		);
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const shown = () =>
				[...html.querySelectorAll(".commandinput")].map((c) => !c.classList.contains("commandHidden"));
			const a = html.querySelector(".commandinput input") as HTMLInputElement;
			const seen: boolean[][] = [];
			for (const ch of ["h", "he", "hel"]) {
				a.value = ch;
				a.dispatchEvent(new KeyboardEvent("keyup", {key: ch.at(-1)}));
				seen.push(shown());
			}
			expect(seen).toEqual([
				[true, true, false],
				[true, true, false],
				[true, true, false],
			]);
		} finally {
			html.remove();
		}
	});

	it("a sent attachment does not haunt the command's next run", async () => {
		const {localuser, channel} = messageIn("100");
		(channel as unknown as {uploadFile: unknown}).uploadFile = async () => [
			{id: "0", upload_url: "http://dm.test/up/0", upload_filename: "77/0/kitten.png"},
		];
		const command = new Command(
			commandJson([{type: 11, name: "image", description: ""}]),
			localuser,
		);
		captureRequests(API + "/interactions");
		const html = document.createElement("div");
		document.body.append(html);
		try {
			command.render(html, channel as never);
			const option = command.options[0] as unknown as {
				pick: (files: globalThis.File[], channel: unknown) => Promise<void>;
			};
			await option.pick([new File(["png"], "kitten.png", {type: "image/png"})], channel);
			await expect(command.submit(html, channel as never)).resolves.toBe(true);
			// The next /image in this channel starts clean: no filename on an empty option.
			command.render(html, channel as never);
			const chip = html.querySelector(".commandinput[commandName='image']") as HTMLElement;
			expect(chip.textContent).not.toContain("kitten.png");
		} finally {
			html.remove();
		}
	});
});
