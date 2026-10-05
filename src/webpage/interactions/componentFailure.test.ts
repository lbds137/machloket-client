import {afterEach, describe, expect, it, vi} from "vitest";
import {dmMessage} from "../test/interactionFixture";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first); the fixture loads localuser first.
const {Components} = await import("./compontents");

afterEach(() => vi.restoreAllMocks());

/** A message with one button and one select, and what its interaction line was told. */
function messageWithControls() {
	const {localuser, message} = dmMessage();
	const shown = vi.spyOn(message, "interactionEvents").mockImplementation(() => {});
	const [button, select] = new Components(
		[
			{type: 2, style: 1, custom_id: "go", label: "Go"},
			{type: 3, custom_id: "pick", options: [{label: "Large", value: "l"}]},
		],
		message,
	).components as unknown as [
		{clickEvent: () => Promise<void>},
		{submit: (values: string[]) => Promise<void>},
	];
	const failures = () => shown.mock.calls.filter(([e]) => e.t === "INTERACTION_FAILURE");
	return {localuser, button, select, failures};
}

describe("a button or select the instance refuses", () => {
	for (const [label, answer] of [
		["refused", () => Promise.resolve(Response.json({message: "Unknown"}, {status: 404}))],
		["unreachable", () => Promise.reject(new TypeError("Failed to fetch"))],
	] as const) {
		it(`(${label}) shows the interaction failed and forgets it`, async () => {
			vi.spyOn(globalThis, "fetch").mockImplementation(answer);
			const {localuser, button, select, failures} = messageWithControls();

			await button.clickEvent();
			await select.submit(["l"]);

			expect(failures()).toHaveLength(2);
			expect(localuser.interNonceMap.size).toBe(0);
			expect(localuser.interactionNonces.size).toBe(0);
		});
	}

	it("an accepted click waits for the bot instead", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 204}));
		const {localuser, button, failures} = messageWithControls();

		await button.clickEvent();

		expect(failures()).toHaveLength(0);
		expect(localuser.interNonceMap.size).toBe(1);
	});
});
