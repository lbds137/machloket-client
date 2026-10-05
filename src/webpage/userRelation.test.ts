import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {User} = await import("./user");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

function userOf(owner: InstanceType<typeof Localuser>) {
	return Object.assign(Object.create(User.prototype), {id: "u2", owner}) as InstanceType<
		typeof User
	>;
}

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: "http://rel.test/api/v9"},
		headers: {},
		relChangeUpdateMap: new Map(),
	}) as InstanceType<typeof Localuser>;
}

// A refusal never produces a RELATIONSHIP_ADD/REMOVE event, which is all the old code waited for.
const settled = (p: Promise<unknown>) =>
	Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 200))]);

it("a refused friend request says so and stops waiting for a change that won't come", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "Unknown User", code: 10013}, {status: 404}),
	);
	const owner = localuser();

	expect(await settled(userOf(owner).changeRelationship(1))).toBe("settled");
	expect(owner.relChangeUpdateMap.has("u2")).toBe(false);
	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 404"));
});

it("an unreachable instance does the same for an unblock", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	const owner = localuser();

	expect(await settled(userOf(owner).changeRelationship(0))).toBe("settled");
	expect(owner.relChangeUpdateMap.has("u2")).toBe(false);
	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("a refusal leaves another waiter for the same user (an open profile) waiting", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 400}));
	const owner = localuser();
	const profileWaiter = owner.relationChange("u2");

	await settled(userOf(owner).changeRelationship(1));

	expect(owner.relChangeUpdateMap.get("u2")).toHaveLength(1);
	expect(await settled(profileWaiter)).toBe("pending");
});

// A regression pin (passes before the fix too): an accepted change resolves on the gateway event.
it("an accepted change resolves when the gateway reports it", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 204}));
	const owner = localuser();
	const change = userOf(owner).changeRelationship(2);
	await new Promise((r) => setTimeout(r, 0));

	expect(await settled(change)).toBe("pending");
	owner.relChangeUpdateMap.get("u2")!.forEach((resolve) => resolve());
	expect(await settled(change)).toBe("settled");
});
