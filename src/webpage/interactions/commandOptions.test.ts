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
