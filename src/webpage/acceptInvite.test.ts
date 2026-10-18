import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {acceptInvite} = await import("./invite");

const API = "http://invite.test/api/v9";

const refusal = (message: string) => () =>
	new Response(JSON.stringify({code: 400, message}), {
		status: 400,
		headers: {"Content-Type": "application/json"},
	});

describe("accepting an invite", () => {
	it("a member who is already in the guild has joined it: the accept is a success", async () => {
		captureRequests(API + "/invites/abc", refusal("You are already a member of this guild"));

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.ok).toBe(true);
	});

	it("any other refusal stays a refusal, with the server's message", async () => {
		captureRequests(API + "/invites/abc", refusal("Invite expired"));

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.ok).toBe(false);
		expect(result.message).toBe("Invite expired");
	});

	it("a fresh join names the guild it joined", async () => {
		captureRequests(
			API + "/invites/abc",
			() =>
				new Response(JSON.stringify({code: "abc", guild_id: "g9", channel_id: "c1"}), {
					headers: {"Content-Type": "application/json"},
				}),
		);

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.ok).toBe(true);
		expect((result as {guildId?: string}).guildId).toBe("g9");
	});

	it("a fresh join answered with Discord's invite object (a guild object) names the guild too", async () => {
		captureRequests(API + "/invites/abc", () =>
			Response.json({code: "abc", guild: {id: "g9", name: "Home"}, channel: {id: "c1"}}),
		);

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.guildId).toBe("g9");
	});
});
