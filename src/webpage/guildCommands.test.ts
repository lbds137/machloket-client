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
			API_ROOT + "/guilds/@me/application-command-index",
			() =>
				new Response(JSON.stringify({code: 10013, message: "Unknown Guild"}), {
					status: 404,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const direct = guildWithId("@me");

		const {apps, commands} = await direct.getCommandsFetch();

		expect(apps).toEqual([]);
		expect(commands).toEqual([]);
	});
});
