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

/** A command object as the index builds it; each call is a new object (a refetch makes new ones). */
function command(id = "555") {
	const lu = session();
	return Object.assign(Object.create(Command.prototype), {
		id,
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

	it("the same context command on two different messages sends both", async () => {
		const bodies = captureRequests("http://test.local/api/v9/interactions");
		const channel = {id: "200", owner: {id: "100"}};
		const cmd = command();

		await Promise.all([
			cmd.submitContext("42", channel as never),
			cmd.submitContext("43", channel as never),
		]);

		// One POST in flight for target 42 must not swallow the invoke on target 43.
		expect(bodies).toMatchObject([{data: {target_id: "42"}}, {data: {target_id: "43"}}]);
	});

	// A send that hangs: the first POST never settles, so its guard stays held.
	const hangingFirstPost = () => {
		let posts = 0;
		const bodies = captureRequests("http://test.local/api/v9/interactions", () => {
			posts++;
			return posts === 1 ? new Promise<Response>(() => {}) : new Response(null, {status: 204});
		});
		return {bodies, posts: () => posts};
	};
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("a command-index refetch mid-send doesn't reopen the double tap: the same target through a new object is blocked", async () => {
		const {posts} = hangingFirstPost();
		const channel = {id: "200", owner: {id: "100"}};
		const first = command();
		// What a command-index refetch hands back for the same command: another object, same ids.
		const refetched = command();

		void first.submitContext("42", channel as never);
		await flush();
		expect(posts()).toBe(1);

		expect(await refetched.submitContext("42", channel as never)).toBe(false);
	});

	it("a refetched object sends a different target while the first is in flight", async () => {
		const {bodies} = hangingFirstPost();
		const channel = {id: "200", owner: {id: "100"}};

		void command().submitContext("42", channel as never);
		await flush();

		expect(await command().submitContext("43", channel as never)).toBe(true);
		expect(bodies[1]).toMatchObject({data: {id: "555", target_id: "43"}});
	});

	it("a different command on the same target sends while the first is in flight", async () => {
		const {bodies} = hangingFirstPost();
		const channel = {id: "200", owner: {id: "100"}};

		void command("555").submitContext("42", channel as never);
		await flush();

		expect(await command("556").submitContext("42", channel as never)).toBe(true);
		expect(bodies[1]).toMatchObject({data: {id: "556", target_id: "42"}});
	});
});
