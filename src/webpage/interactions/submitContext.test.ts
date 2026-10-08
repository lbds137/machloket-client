import {describe, expect, it} from "vitest";
import {captureRequests} from "../test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("../localuser");
const {Command} = await import("./commands");

/** Just enough of a logged-in session for submitContext's nonce bookkeeping. */
const session = () =>
	Object.assign(Object.create(Localuser.prototype), {
		session_id: "sess",
		registerCommandNonce: () => {},
		forgetCommandNonce: () => {},
	}) as InstanceType<typeof Localuser>;

function command() {
	const lu = session();
	return Object.assign(Object.create(Command.prototype), {
		id: "555",
		// A guild-owned command: localuser resolves through owner.owner.
		owner: {owner: lu, id: "100", info: {api: "http://test.local/api/v9"}, headers: {}},
		type: 3,
		applicationId: "777",
		name: "Report",
	}) as InstanceType<typeof Command>;
}

describe("submitContext", () => {
	it("one context command, one POST - even when the tap fires twice", async () => {
		const bodies = captureRequests("http://test.local/api/v9/interactions");
		const channel = {id: "200", owner: {id: "100"}};
		const cmd = command();

		await Promise.all([
			cmd.submitContext("42", channel as never),
			cmd.submitContext("42", channel as never),
		]);

		expect(bodies.length).toBe(1);
		expect(bodies[0]).toMatchObject({type: 2, data: {id: "555", target_id: "42"}});
	});
});
