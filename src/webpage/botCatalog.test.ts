import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {getExplorerBotByUsername} = await import("./utils/utils");

const CATALOG = "https://sbar.fyi/api/catalog/bots";

afterEach(() => {
	vi.restoreAllMocks();
});

it("the catalog is fetched on the first bot-profile ask only", async () => {
	const fetches = vi.spyOn(globalThis, "fetch");

	await getExplorerBotByUsername("bolt");
	const first = fetches.mock.calls.filter(([url]) => String(url) === CATALOG).length;
	expect(first).toBe(1);

	// A second ask (any name) reuses the one fetch.
	await getExplorerBotByUsername("caps");
	expect(fetches.mock.calls.filter(([url]) => String(url) === CATALOG).length).toBe(1);
});
