import {expect, it} from "vitest";
import {captureRequests} from "../test/setup";
import {authorizeBot, fetchBotInvite} from "./botInvite";

const {I18n} = await import("../i18n");
await I18n.done;

const API = "http://bots.test/api/v9";
const AUTHORIZE = API + "/oauth2/authorize/";
const unknownApp = () =>
	Response.json({code: 10002, message: "Unknown Application"}, {status: 404});

it("a bot invite the server won't show comes back as why", async () => {
	captureRequests(AUTHORIZE, unknownApp);

	const invite = await fetchBotInvite(API, "t", "?client_id=9").catch((e: unknown) => e);

	expect(invite).toBe(I18n.requestFailed("Unknown Application"));
});

it("a bot invite that never arrived comes back as offline", async () => {
	captureRequests(AUTHORIZE, () => Promise.reject(new TypeError("Failed to fetch")));

	const invite = await fetchBotInvite(API, "t", "?client_id=9").catch((e: unknown) => e);

	expect(invite).toBe(I18n.requestFailed("offline"));
});

it("a bot the server won't add says why", async () => {
	captureRequests(API + "/oauth2/authorize", () =>
		Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);

	const added = await authorizeBot(API, "t", "9", "g1", "8").catch((e: unknown) => e);

	expect(added).toBe(I18n.requestFailed("Missing Permissions"));
});

it("a bot the server adds says so, sending the server and permissions picked", async () => {
	const sent = captureRequests(API + "/oauth2/authorize", () => new Response(null, {status: 204}));

	expect(await authorizeBot(API, "t", "9", "g1", "8")).toBe(true);
	expect(sent).toEqual([{authorize: true, guild_id: "g1", permissions: "8"}]);
});
