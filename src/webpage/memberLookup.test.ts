import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
const {Localuser} = await import("./localuser");

const API_ROOT = "http://refresh.test/api/v9";

/** A Localuser with only what getMember and refreshURL read. */
function lookupUser() {
	return Object.assign(Object.create(Localuser.prototype), {
		userMap: new Map(),
		guildids: new Map([["g1", {id: "g1"}]]),
		getMemberMap: new Map(),
		urlsToRefresh: [],
		info: {api: API_ROOT},
	}) as InstanceType<typeof Localuser>;
}

describe("member lookup", () => {
	it("a lookup that found no member is asked again next time, not cached", async () => {
		const user = lookupUser();
		const resolvemember = vi.fn(async () => undefined);
		user.resolvemember = resolvemember;

		expect(await user.getMember("u1", "g1")).toBeUndefined();
		await user.getMember("u1", "g1");

		expect(resolvemember).toHaveBeenCalledTimes(2);
	});
});

describe("attachment URL refresh", () => {
	it("each queued URL gets its refreshed form, in order; one left unrefreshed keeps its own", async () => {
		captureRequests(
			API_ROOT + "/attachments/refresh-urls",
			() =>
				new Response(JSON.stringify({refreshed_urls: ["https://cdn.test/a.png?ex=1"]}), {
					headers: {"Content-Type": "application/json"},
				}),
		);
		const user = lookupUser();
		Object.defineProperty(user, "headers", {value: {}});

		const refreshed = await Promise.all([
			user.refreshURL("https://cdn.test/a.png"),
			user.refreshURL("https://cdn.test/b.png"),
		]);

		expect(refreshed).toEqual(["https://cdn.test/a.png?ex=1", "https://cdn.test/b.png"]);
	});

	it("a failed refresh hands back the original URLs instead of leaving them pending", async () => {
		captureRequests(API_ROOT + "/attachments/refresh-urls", () => new Response("bad gateway", {status: 502}));
		const user = lookupUser();
		Object.defineProperty(user, "headers", {value: {}});

		const refreshed = await Promise.race([
			Promise.all([user.refreshURL("https://cdn.test/a.png"), user.refreshURL("https://cdn.test/b.png")]),
			new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 2000)),
		]);

		expect(refreshed).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
	});
});
