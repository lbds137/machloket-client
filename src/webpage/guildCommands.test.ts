import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as pinsPanel.test.ts.
await import("./localuser");
const {Guild} = await import("./guild");

const API_ROOT = "http://guild.test";

/** A Guild with only what getCommandsFetch reads: Guild's info getter resolves through its
 * owner, so the stub provides one (same Object.create pattern as the fixture). */
function guildWithId(id: string) {
	return Object.assign(Object.create(Guild.prototype), {
		id,
		owner: {
			info: {api: API_ROOT},
			headers: {"Content-type": "application/json", Authorization: "token"},
		},
	}) as InstanceType<typeof Guild>;
}

describe("application-command index fetch", () => {
	it("an error body (a non-200 answer) degrades to no commands, not a crash", async () => {
		captureRequests(
			API_ROOT + "/guilds/1554722916606791818/application-command-index",
			() =>
				new Response(JSON.stringify({code: 10013, message: "Unknown Guild"}), {
					status: 404,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const direct = guildWithId("1554722916606791818");

		const {apps, commands} = await direct.getCommandsFetch();

		expect(apps).toEqual([]);
		expect(commands).toEqual([]);
	});

	it('the "@me" guild fetches the user command index, not a guild route', async () => {
		const sent = captureRequests(API_ROOT + "/users/@me/application-command-index", () =>
			new Response(
				JSON.stringify({
					applications: [{id: "300", name: "TzurotProbeB"}],
					application_commands: [
						{id: "900", type: 1, application_id: "300", name: "row9", description: "", dm_permission: true},
					],
				}),
				{headers: {"Content-Type": "application/json"}},
			),
		);
		const direct = guildWithId("@me");

		const {apps, commands} = await direct.getCommandsFetch();

		expect(sent).toHaveLength(1);
		expect(apps).toEqual([{id: "300", name: "TzurotProbeB"}]);
		expect(commands).toHaveLength(1);
		expect((commands[0] as unknown as {name: string}).name).toBe("row9");
	});

	it("context-menu commands are stored but never offered in the slash popup", async () => {
		captureRequests(API_ROOT + "/guilds/1554722916606791818/application-command-index", () =>
			new Response(
				JSON.stringify({
					applications: [{id: "300", name: "Tzurot"}],
					application_commands: [
						{id: "1", type: 1, application_id: "300", name: "random", description: "", dm_permission: true},
						{id: "2", type: 3, application_id: "300", name: "Inspect Message", description: "", dm_permission: true},
					],
				}),
				{headers: {"Content-Type": "application/json"}},
			),
		);
		const guild = guildWithId("1554722916606791818");

		const slashCommands = await guild.getCommands();

		const names = (slashCommands as unknown as {name: string}[]).map((c) => c.name);
		expect(names).toContain("random");
		expect(names).not.toContain("Inspect Message");
	});
});
