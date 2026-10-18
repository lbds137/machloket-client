import {expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://sessions.test/api/v9";
const SESSIONS = API + "/auth/sessions";

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {},
	}) as InstanceType<typeof Localuser>;
}

it("a session list the server won't give comes back as why", async () => {
	captureRequests(SESSIONS, () =>
		Response.json({message: "You are being rate limited."}, {status: 429}),
	);

	const sessions = await localuser()
		.fetchSessions()
		.catch((e: unknown) => e);

	expect(sessions).toBe(I18n.requestFailed("You are being rate limited."));
});

it("a session list that never arrived comes back as offline", async () => {
	captureRequests(SESSIONS, () => Promise.reject(new TypeError("Failed to fetch")));

	const sessions = await localuser()
		.fetchSessions()
		.catch((e: unknown) => e);

	expect(sessions).toBe(I18n.requestFailed("offline"));
});

it("sessions come back the most recently seen first", async () => {
	captureRequests(SESSIONS, () =>
		Response.json({
			user_sessions: [
				{id: "old", last_seen: "2026-10-01T00:00:00Z"},
				{id: "new", last_seen: "2026-10-18T00:00:00Z"},
			],
		}),
	);

	const sessions = await localuser().fetchSessions();

	expect(Array.isArray(sessions) && sessions.map(({id}) => id)).toEqual(["new", "old"]);
});
