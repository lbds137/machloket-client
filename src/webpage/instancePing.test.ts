import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://ping.test/api/v9";
const WELLKNOWN = "http://ping.test";

// The app keeps a userinfos record from its first load on; each test starts with an empty one.
beforeEach(() => {
	localStorage.setItem("userinfos", "{}");
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem("userinfos");
	document.body.replaceChildren();
});

function localuser() {
	const user = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, wellknown: WELLKNOWN},
		headers: {},
		instancePing: {name: "Unknown"},
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(user, "pageTitle").mockImplementation(() => {});
	return user;
}

const cached = () =>
	(JSON.parse(localStorage.getItem("userinfos") ?? "{}") as {instances?: Record<string, unknown>})
		.instances?.[WELLKNOWN];

it("a ping the server refused isn't kept as the instance's details", async () => {
	captureRequests(API + "/ping", () =>
		Response.json({message: "You are being rate limited.", retry_after: 1}, {status: 429}),
	);
	const user = localuser();

	await user.pingEndpoint();

	expect(cached()).toBeUndefined();
	expect(user.instancePing.name).toBe("Unknown");
});

it("details kept from an earlier refused ping are asked for again", async () => {
	localStorage.setItem(
		"userinfos",
		JSON.stringify({instances: {[WELLKNOWN]: {message: "You are being rate limited."}}}),
	);
	captureRequests(API + "/ping", () => Response.json({instance: {name: "Home"}}));
	const user = localuser();

	await user.pingEndpoint();

	expect(user.instancePing?.name).toBe("Home");
	expect(cached()).toEqual({instance: {name: "Home"}});
});

it("instance stats the server won't give say why", async () => {
	captureRequests(API + "/policies/stats", () =>
		Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);

	await localuser().instanceStats();

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a ping that never got through leaves the instance unnamed, and the title still set", async () => {
	captureRequests(API + "/ping", () => Promise.reject(new TypeError("Failed to fetch")));
	const user = localuser();

	await user.pingEndpoint();

	expect(user.instancePing.name).toBe("Unknown");
	expect(user.pageTitle).toHaveBeenCalledWith("Loading...");
	expect(cached()).toBeUndefined();
});
