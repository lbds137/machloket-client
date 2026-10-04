import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

/** Same fixture as historyFetch.test.ts: the fetched messages are already known. */
function channelWith(ids: string[]) {
	return Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {info: {api: "http://history.test/api/v9"}},
		headers: {},
		messages: new Map(ids.map((id) => [id, {id}])),
		idToPrev: new Map(),
		idToNext: new Map(),
		beforeProms: new Map(),
		afterProms: new Map(),
		historyFailures: 0,
	}) as InstanceType<typeof Channel>;
}

afterEach(() => vi.restoreAllMocks());

describe("two history lookups at once", () => {
	it("a second id waits for its own page instead of taking the first one's", async () => {
		const channel = channelWith(["9", "8", "4", "3"]);
		const pages = new Map([
			["before=10", [{id: "9"}, {id: "8"}]],
			["before=5", [{id: "4"}, {id: "3"}]],
		]);
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((res) => (releaseFirst = res));
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const query = "before=" + new URL(String(input)).searchParams.get("before");
			if (query === "before=10") await firstGate;
			return Response.json(pages.get(query) ?? []);
		});

		const first = channel.grabBefore("10");
		// A jump to an older message (a pin, a reply) while the scroller's page is loading.
		const second = channel.grabBefore("5");
		releaseFirst();
		await first;
		await Promise.race([second, new Promise((res) => setTimeout(res, 1500))]);

		expect(channel.idToPrev.get("10")).toBe("9");
		expect(channel.idToPrev.get("5")).toBe("4");
	});
});
