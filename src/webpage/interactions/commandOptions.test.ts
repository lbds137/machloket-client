import {describe, expect, it} from "vitest";
import {captureRequests} from "../test/setup";
import {API, messageIn} from "../test/interactionFixture";
import type {commandJson as commandJsonT, commandOptionJson} from "../jsontypes.js";

// The fixture loads localuser (and I18n) first; commands.js comes after.
const {Command} = await import("./commands.js");

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
		(channel as unknown as {users?: unknown}).users = [{id: "9", name: "the owner"}];
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

	it("the live flow works: render seeds the branch, its leaves reach state and collect keeps them", async () => {
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
			// render seeds the branch chip; its microtask self-activates and renders the leaves
			// (the chip must be connected, as the real composer's typebox always is).
			await new Promise((r) => setTimeout(r, 0));

		const chips = [...html.querySelectorAll(".commandinput")];
		expect(chips.length).toBe(2); // the branch chip and the required leaf's
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
		}
	});
});
