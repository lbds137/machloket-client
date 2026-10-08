import {afterEach, describe, expect, it, onTestFinished, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {InfiniteScroller} = await import("./infiniteScroller");

/** Settles within `ms`, or reports that it hung. */
const within = <T,>(p: Promise<T>, ms = 1500) =>
	Promise.race([
		p.then(
			() => "settled",
			() => "settled",
		),
		new Promise<string>((res) => setTimeout(() => res("hung"), ms)),
	]);

/** A channel whose history already holds the messages a fetch would return, so the paging
 * paths link ids without building Message objects. */
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

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a failed history fetch", () => {
	for (const [label, failure] of [
		["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
		[
			"a 429 error body",
			() => Promise.resolve(Response.json({message: "rate limited", retry_after: 1}, {status: 429})),
		],
	] as const) {
		it(`(${label}) settles, and the next scroll-up fetches again`, async () => {
			const channel = channelWith(["9", "8"]);
			const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(failure);

			expect(await within(channel.grabBefore("10"))).toBe("settled");
			expect(channel.idToPrev.has("10")).toBe(false);

			fetchMock.mockResolvedValueOnce(Response.json([{id: "9"}, {id: "8"}]));
			expect(await within(channel.grabBefore("10"))).toBe("settled");
			expect(channel.idToPrev.get("10")).toBe("9");
		});
	}

	it("isn't read as the channel's top by a second caller waiting on the same fetch", async () => {
		const channel = channelWith([]);
		Object.assign(channel, {lastmessage: undefined});
		channel.setUpInfiniteScroller();
		let fail!: () => void;
		vi.spyOn(globalThis, "fetch").mockImplementationOnce(
			() => new Promise((_, rej) => (fail = () => rej(new TypeError("Failed to fetch")))),
		);
		const ask = (id: string) => channel.infinite.getIDFromOffset(id, 1);

		const first = ask("10");
		const second = ask("20"); // arrives while the first page is in flight
		fail();

		expect(await first.then(() => "top", () => "retry later")).toBe("retry later");
		expect(await second.then(() => "top", () => "retry later")).toBe("retry later");
	});

	it("going forward settles too", async () => {
		const channel = channelWith([]);
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
		expect(await within(channel.grabAfter("10"))).toBe("settled");
		expect(channel.idToNext.has("10")).toBe(false);
	});
});

describe("a history page whose messages can't be built", () => {
	// {id: "7"} isn't loaded and has no author, so building its Message throws mid-page.
	it("going back settles, and the next scroll-up asks again", async () => {
		const channel = channelWith([]);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{id: "7"}]));

		expect(await within(channel.grabBefore("10"))).toBe("settled");
		expect(channel.beforeProm).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		expect(await within(channel.grabBefore("10"))).toBe("settled");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("going forward settles, and the next scroll-down asks again", async () => {
		const channel = channelWith([]);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{id: "7"}]));

		expect(await within(channel.grabAfter("10"))).toBe("settled");
		expect(channel.afterProm).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		expect(await within(channel.grabAfter("10"))).toBe("settled");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("the message scroller after a failed page", () => {
	it("finishes rendering, and doesn't take the failure for the top of the channel", async () => {
		let fail = true;
		const asked: string[] = [];
		const scroller = new InfiniteScroller(
			async (id, offset) => {
				if (offset !== 1) return undefined;
				asked.push(id);
				if (id === "5" && fail) throw new TypeError("Failed to fetch");
				return id === "5" ? "4" : undefined;
			},
			(id) => {
				const div = document.createElement("div");
				div.textContent = "message " + id;
				return div;
			},
			async () => true,
		);
		const host = document.createElement("div");
		document.body.append(host);

		const shown = scroller.getDiv("5");
		expect(await within(shown)).toBe("settled");
		host.append(await shown);

		fail = false;
		await within(scroller.focus("5", false));
		expect(asked.filter((id) => id === "5").length).toBeGreaterThanOrEqual(2);
		expect(host.textContent).toContain("message 4");
		host.remove();
	});
});

describe("jumping to a message the instance won't give", () => {
	it("reads an error answer as no message, not as a message", async () => {
		const channel = channelWith([]);
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			Response.json({message: "Missing Access", code: 50001}, {status: 403}),
		);

		expect(await channel.getmessage("5")).toBeUndefined();
	});

	it("takes the loading skeleton down when the lookup fails", async () => {
		const loading = document.createElement("div");
		loading.id = "loadingdiv";
		document.body.append(loading);
		onTestFinished(() => loading.remove());
		const channel = channelWith([]);
		// Slower than the 300 ms after which the skeleton shows, then the network drops.
		vi.spyOn(channel, "getMessages").mockReturnValueOnce(
			new Promise((_, rej) => setTimeout(() => rej(new TypeError("Failed to fetch")), 400)),
		);

		await channel.focus("5").catch(() => {});

		expect(loading.classList.contains("loading")).toBe(false);
	});
});
