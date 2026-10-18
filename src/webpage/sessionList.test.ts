import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Settings} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://sessions.test/api/v9";
const SESSIONS = API + "/auth/sessions";
const initialLang = I18n.lang;

afterEach(() => {
	I18n.lang = initialLang;
	vi.restoreAllMocks();
});

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

it("the sessions pane formats each session's relative last_seen time with I18n.locale", async () => {
	vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
	I18n.lang = "en";
	const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
	captureRequests(SESSIONS, () =>
		Response.json({
			user_sessions: [{id: "s1", last_seen: fiveMinAgo}],
		}),
	);
	captureRequests(API + "/teams", () => new Promise(() => {}));
	const areas = vi.spyOn(Settings.Options.prototype, "addHTMLArea");
	const hypo = {pronouns: "", bio: "", buildprofile: async () => document.createElement("div")};
	const user = Object.assign(localuser(), {
		user: {pronouns: "", bio: {rawString: ""}, getpfpsrc: () => "", clone: () => hypo},
		userinfo: {localuserStore: {user: {}}},
		getConnections: () => new Promise(() => {}),
	});

	await user.showusersettings().catch(() => {});
	await vi.waitFor(() =>
		expect(
			areas.mock.calls.some(
				([el]) => el instanceof HTMLElement && el.classList.contains("sessionDiv"),
			),
		).toBe(true),
	);
	const row = areas.mock.calls
		.map(([el]) => el as HTMLElement)
		.find((el) => el instanceof HTMLElement && el.classList.contains("sessionDiv"))!;

	expect(row.querySelector("span")?.textContent).toBe(
		new Intl.RelativeTimeFormat("en-GB", {style: "short"}).format(-5, "minutes"),
	);
});
