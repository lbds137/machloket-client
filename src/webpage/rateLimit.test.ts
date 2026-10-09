import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {retryAfterMs} = await import("./utils/rateLimit");
const {acceptInvite} = await import("./invite");

const API = "http://limit.test/api/v9";
const limited = () => Response.json({message: "rate limited", retry_after: 0.05}, {status: 429});

/** Answers the first call with `first`, then every later one with `rest`. */
function sequence(first: () => Response, rest: () => Response) {
	let calls = 0;
	return () => (calls++ === 0 ? first() : rest());
}

function channelAt(extra: object = {}) {
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: {id: "g1", info: {api: API}, unreads: () => {}},
		headers: {},
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
		message_notifications: 1,
		unreads: () => {},
		...extra,
	}) as InstanceType<typeof Channel>;
}

afterEach(() => {
	vi.restoreAllMocks();
	Channel.historyCooldownUntil = 0;
});

describe("retryAfterMs", () => {
	it("reads the body's retry_after as seconds", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: 2}))).toBe(2000);
	});
	it("accepts a numeric string", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: "1.5"}))).toBe(1500);
	});
	it("defaults to 5 s when the body is missing or isn't JSON", () => {
		expect(retryAfterMs(429, null)).toBe(5000);
		expect(retryAfterMs(429, "<html>slow down</html>")).toBe(5000);
		expect(retryAfterMs(429, "{}")).toBe(5000);
	});
	it("caps the wait at 30 s", () => {
		expect(retryAfterMs(429, JSON.stringify({retry_after: 600}))).toBe(30000);
	});
	it("is null for any status but 429", () => {
		expect(retryAfterMs(200, JSON.stringify({retry_after: 2}))).toBeNull();
		expect(retryAfterMs(500, null)).toBeNull();
	});
});

describe("the first history page of a channel", () => {
	it("a 429 isn't the channel's top, and arms the shared cooldown", async () => {
		captureRequests(API + "/channels/c1/messages", () =>
			Response.json({message: "rate limited", retry_after: 30}, {status: 429}),
		);
		const channel = channelAt();

		await channel.putmessages().catch(() => {});

		expect(channel.allthewayup).toBeFalsy();
		expect(Channel.historyCooldownUntil).toBeGreaterThan(Date.now());
	});
});

describe("an attachment upload slot", () => {
	const slot = () =>
		Response.json({
			attachments: [{id: "0", upload_url: "http://limit.test/put", upload_filename: "up/x"}],
		});
	const file = new File(["hi"], "x.txt");

	it("a 429 waits its window, asks again once, and the upload lands", async () => {
		const asked = captureRequests(API + "/channels/c1/attachments", sequence(limited, slot));
		captureRequests("http://limit.test/put", () => new Response(null, {status: 200}));

		const got = await channelAt().uploadFile([file]);

		expect(asked).toHaveLength(2);
		expect(got[0].upload_filename).toBe("up/x");
	});

	it("a second 429 throws an error that names the status", async () => {
		const asked = captureRequests(API + "/channels/c1/attachments", limited);

		await expect(channelAt().uploadFile([file])).rejects.toThrow(/429/);
		expect(asked).toHaveLength(2);
	});
});

describe("accepting an invite", () => {
	it("a 429 waits its window and asks again once", async () => {
		const asked = captureRequests(API + "/invites/abc", sequence(limited, () => Response.json({})));

		const result = await acceptInvite(API, "abc", "tok");

		expect(asked).toHaveLength(2);
		expect(result.ok).toBe(true);
	});

	it("a second 429 isn't a join", async () => {
		captureRequests(API + "/invites/abc", limited);

		const result = await acceptInvite(API, "abc", "tok");

		expect(result.ok).toBe(false);
	});
});

describe("a notification-settings PATCH", () => {
	it("a 429 waits its window and asks again once", async () => {
		const sent = captureRequests(
			API + "/users/@me/guilds/g1/settings",
			sequence(limited, () => Response.json({})),
		);

		channelAt().unmuteChannel();

		await vi.waitFor(() => expect(sent).toHaveLength(2), {timeout: 1500});
	});
});
