import {describe, expect, it} from "vitest";
import {mergeInstanceLists} from "./instanceOverlay";
import publicList from "../public/instances.json";

const own = [
	{name: "Mine", icon: "/logo.svg", description: "tailnet", url: "https://{hostname}:8443"},
	{name: "Mine (local)", icon: "/logo.svg", description: "LAN", url: "http://{hostname}:3001"},
];

describe("a deployment's own instances overlay the public list", () => {
	it("puts the overlay first, so the default pick (first by scheme) is the deployment's own", () => {
		const merged = mergeInstanceLists(publicList, own);

		expect(merged.map((i) => i.url).slice(0, 2)).toEqual([
			"https://{hostname}:8443",
			"http://{hostname}:3001",
		]);
		// The first https entry is the own instance, ahead of the public spacebar.chat.
		expect(merged.find((i) => i.url.startsWith("https:"))?.name).toBe("Mine");
	});

	it("keeps the public entries, minus any URL the overlay already lists", () => {
		const merged = mergeInstanceLists(publicList, own);

		expect(merged.map((i) => i.url)).toEqual([
			"https://{hostname}:8443",
			"http://{hostname}:3001",
			"https://spacebar.chat",
		]);
		// The overlay's description wins for the shared URL.
		expect(merged[1].name).toBe("Mine (local)");
	});

	it("a trailing slash doesn't make the same instance a second entry", () => {
		const merged = mergeInstanceLists(publicList, [
			{name: "Mine", url: "https://spacebar.chat/"},
		]);

		expect(merged.filter((i) => i.url.includes("spacebar.chat"))).toHaveLength(1);
	});

	it("with no overlay, the public list is served unchanged", () => {
		expect(mergeInstanceLists(publicList, undefined)).toEqual(publicList);
	});

	it("refuses an overlay that isn't a list of named instances with URLs", () => {
		expect(() => mergeInstanceLists(publicList, {name: "x"} as never)).toThrow();
		expect(() => mergeInstanceLists(publicList, [{name: "no url"}] as never)).toThrow();
	});
});
