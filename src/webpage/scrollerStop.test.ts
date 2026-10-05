import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {InfiniteScroller} = await import("./infiniteScroller");

afterEach(() => vi.restoreAllMocks());

it("a scroller deleted before it was shown stops waiting to be shown", async () => {
	const scroller = new InfiniteScroller(
		async () => undefined,
		(id) => {
			const div = document.createElement("div");
			div.textContent = "message " + id;
			return div;
		},
		async () => true,
	);
	await scroller.getDiv("5"); // built but never put on the page (the channel was switched)
	await scroller.delete();
	await new Promise((res) => setTimeout(res, 150));

	const polls = vi.spyOn(window, "setTimeout");
	await new Promise((res) => setTimeout(res, 350));

	expect(polls.mock.calls.filter(([, ms]) => ms === 350)).toHaveLength(1); // the spy sees timers
	expect(polls.mock.calls.filter(([, ms]) => ms === 100)).toHaveLength(0);
});
