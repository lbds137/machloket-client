import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "../test/setup.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("../localuser");
const {Bot} = await import("../bot");
const {User} = await import("../user");
const {acceptInvite} = await import("./acceptInvite.js");
const {authorizeBot, fetchBotInvite} = await import("../oauth2/botInvite.js");
const {Specialuser} = await import("./utils.js");
const {
	CSRF_HEADER,
	accountUidOf,
	applyAccountHeaders,
	buildAccountHeaders,
	credentialsFor,
	deriveHeaders,
	readHeader,
	setXhrAccountHeaders,
} = await import("./accountHeaders.js");

function makeHeaderUser(token = "fake-header-token") {
	return new Specialuser({
		serverurls: {
			api: "https://account-headers.test/api",
			cdn: "https://account-headers.test/cdn",
			gateway: "wss://account-headers.test/gateway",
			wellknown: "https://account-headers.test",
		},
		email: "header@example.test",
		token,
	});
}

function makeCookieUser() {
	return new Specialuser({
		serverurls: {
			api: "https://account-headers.test/api",
			cdn: "https://account-headers.test/cdn",
			gateway: "wss://account-headers.test/gateway",
			wellknown: "https://account-headers.test",
		},
		email: "cookie@example.test",
		auth_mode: "cookie",
	});
}

describe("buildAccountHeaders", () => {
	it("builds header-mode headers with Authorization, Content-type by default, and no CSRF key", () => {
		const user = makeHeaderUser("fake-tok-1");
		expect(user.authMode).toBeUndefined();

		const h = buildAccountHeaders(user);
		expect(h).toEqual({
			"Content-type": "application/json; charset=UTF-8",
			Authorization: "fake-tok-1",
		});
		expect(CSRF_HEADER in h).toBe(false);

		const noJson = buildAccountHeaders(user, {json: false});
		expect(noJson).toEqual({Authorization: "fake-tok-1"});
		expect("Content-type" in noJson).toBe(false);
		expect(CSRF_HEADER in noJson).toBe(false);
	});

	it("builds cookie-mode headers with CSRF '1' and no Authorization key at all", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const user = makeCookieUser();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(user.authMode).toBe("cookie");
		errorSpy.mockRestore();

		const h = buildAccountHeaders(user);
		expect("Authorization" in h).toBe(false);
		expect(h[CSRF_HEADER]).toBe("1");
		expect(h["Content-type"]).toBe("application/json; charset=UTF-8");

		const noJson = buildAccountHeaders(user, {json: false});
		expect("Authorization" in noJson).toBe(false);
		expect(noJson[CSRF_HEADER]).toBe("1");
		expect("Content-type" in noJson).toBe(false);
	});
});

describe("account uid tagging", () => {
	it("tags builder output, deriveHeaders output, and applyAccountHeaders targets with the account uid", () => {
		const headerUser = makeHeaderUser("fake-tok-a");
		const cookieUser = makeCookieUser();

		const built = buildAccountHeaders(headerUser);
		expect(accountUidOf({headers: built})).toBe(headerUser.uid);

		const mfa = {"X-Discord-MFA-Authorization": "fake-mfa"};
		const withExtra = deriveHeaders(built, {extra: mfa});
		expect(accountUidOf({headers: withExtra})).toBe(headerUser.uid);
		expect(withExtra).toEqual({
			"Content-type": "application/json; charset=UTF-8",
			Authorization: "fake-tok-a",
			"X-Discord-MFA-Authorization": "fake-mfa",
		});

		const withoutJson = deriveHeaders(built, {json: false});
		expect(accountUidOf({headers: withoutJson})).toBe(headerUser.uid);
		expect("Content-type" in withoutJson).toBe(false);
		expect(withoutJson.Authorization).toBe("fake-tok-a");

		// applyAccountHeaders mutates in place, preserves Content-type, and re-tags.
		applyAccountHeaders(built, cookieUser);
		expect(accountUidOf({headers: built})).toBe(cookieUser.uid);
		expect("Authorization" in built).toBe(false);
		expect(built[CSRF_HEADER]).toBe("1");
		expect(built["Content-type"]).toBe("application/json; charset=UTF-8");

		applyAccountHeaders(built, headerUser);
		expect(accountUidOf({headers: built})).toBe(headerUser.uid);
		expect(built.Authorization).toBe("fake-tok-a");
		expect(CSRF_HEADER in built).toBe(false);
		expect(built["Content-type"]).toBe("application/json; charset=UTF-8");
	});

	it("reports undefined for plain literals, derived copies of untagged headers, and Bot headers", () => {
		const user = makeHeaderUser("fake-tok-plain");
		const plain = {
			"Content-type": "application/json; charset=UTF-8",
			Authorization: user.token!, // a header account's fixture: it has one
		};
		expect(accountUidOf({headers: plain})).toBeUndefined();
		expect(accountUidOf({headers: deriveHeaders(plain, {json: false})})).toBeUndefined();
		expect(accountUidOf(undefined)).toBeUndefined();
		expect(accountUidOf({})).toBeUndefined();

		const owner = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
		const botUser = Object.create(User.prototype) as InstanceType<typeof User>;
		const bot = new Bot(botUser, "fake-bot-token", owner);
		expect(accountUidOf({headers: bot.headers})).toBeUndefined();
	});

	it("tags requests sent by acceptInvite, fetchBotInvite, authorizeBot, and Specialuser.logout", async () => {
		const user = makeHeaderUser("fake-raw-page-tok");
		const api = user.serverurls.api;
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		captureRequests(api + "/invites/abc", () => Response.json({guild_id: "g1"}));
		await acceptInvite(api, "abc", buildAccountHeaders(user));
		expect(accountUidOf(fetchSpy.mock.calls.at(-1)?.[1])).toBe(user.uid);

		captureRequests(api + "/oauth2/authorize/", () =>
			Response.json({code: 10002, message: "Unknown Application"}, {status: 404}),
		);
		await fetchBotInvite(api, user, "?client_id=9");
		expect(accountUidOf(fetchSpy.mock.calls.at(-1)?.[1])).toBe(user.uid);

		captureRequests(api + "/oauth2/authorize", () => new Response(null, {status: 204}));
		await authorizeBot(api, user, "9", "g1", "8");
		expect(accountUidOf(fetchSpy.mock.calls.at(-1)?.[1])).toBe(user.uid);

		captureRequests(api + "/auth/logout", () => new Response(null, {status: 204}));
		await user.logout();
		expect(accountUidOf(fetchSpy.mock.calls.at(-1)?.[1])).toBe(user.uid);

		fetchSpy.mockRestore();
	});
});

describe("setXhrAccountHeaders", () => {
	function makeFakeXhr() {
		const calls: [string, unknown][] = [];
		return {
			withCredentials: false,
			calls,
			setRequestHeader(name: string, value: string) {
				calls.push([name, value]);
			},
		};
	}

	it("sets Authorization for a header account, leaves withCredentials false, and skips Content-type and undefined", () => {
		const user = makeHeaderUser("fake-xhr-tok");
		const xhr = makeFakeXhr();
		setXhrAccountHeaders(xhr as unknown as XMLHttpRequest, buildAccountHeaders(user));

		expect(xhr.calls).toEqual([["Authorization", "fake-xhr-tok"]]);
		expect(xhr.withCredentials).toBe(false);

		const emptyXhr = makeFakeXhr();
		const undefHeaders = {"Content-type": "application/json", Authorization: undefined};
		setXhrAccountHeaders(emptyXhr as unknown as XMLHttpRequest, undefHeaders);
		expect(emptyXhr.calls).toEqual([]);
		expect(emptyXhr.withCredentials).toBe(false);
	});

	it("sets the CSRF header and withCredentials = true for a cookie account without calling Authorization", () => {
		const user = makeCookieUser();
		const xhr = makeFakeXhr();
		setXhrAccountHeaders(xhr as unknown as XMLHttpRequest, buildAccountHeaders(user));

		expect(xhr.calls).toEqual([[CSRF_HEADER, "1"]]);
		expect(xhr.withCredentials).toBe(true);
	});
});

describe("readHeader and credentialsFor", () => {
	it("reads headers case-insensitively from records, Headers instances, and tuple arrays", () => {
		expect(readHeader({"x-machloket-csrf": "1"}, CSRF_HEADER)).toBe("1");
		expect(readHeader(new Headers([[CSRF_HEADER, "1"]]), "x-machloket-csrf")).toBe("1");
		expect(readHeader([["X-Machloket-Csrf", "1"]], CSRF_HEADER)).toBe("1");
		expect(readHeader(undefined, CSRF_HEADER)).toBeNull();
	});

	it("implements rules (a)–(e) plus marked unknown host and unmarked host in both sets", () => {
		const apiHosts = new Set(["api.header.test", "api.both.test"]);
		const cookieHosts = new Set(["api.cookie.test", "api.both.test"]);

		const headerUrl = new URL("https://api.header.test/api/v9/users/@me");
		const cookieUrl = new URL("https://api.cookie.test/api/v9/users/@me");
		const bothUrl = new URL("https://api.both.test/api/v9/users/@me");
		const unknownUrl = new URL("https://unknown.test/api/v9/auth/login");
		const marked = {headers: {[CSRF_HEADER]: "1"}};
		const unmarked = {headers: {Authorization: "fake-tok"}};
		const sameOriginMarked: RequestInit = {credentials: "same-origin", ...marked};

		// (a) caller set init.credentials -> that
		expect(credentialsFor(headerUrl, {credentials: "omit"}, apiHosts, cookieHosts)).toBe("omit");
		expect(credentialsFor(cookieUrl, sameOriginMarked, apiHosts, cookieHosts)).toBe("same-origin");

		// (b) request carries the CSRF marker -> "include", whatever the host
		expect(credentialsFor(cookieUrl, marked, apiHosts, cookieHosts)).toBe("include");
		expect(credentialsFor(unknownUrl, marked, apiHosts, cookieHosts)).toBe("include");

		// (c) host in cookieModeHosts (unmarked) -> undefined
		expect(credentialsFor(cookieUrl, undefined, apiHosts, cookieHosts)).toBeUndefined();
		expect(credentialsFor(bothUrl, unmarked, apiHosts, cookieHosts)).toBeUndefined();

		// (d) host in apiHosts (and not in cookieModeHosts) -> "include"
		expect(credentialsFor(headerUrl, undefined, apiHosts, cookieHosts)).toBe("include");

		// (e) else -> undefined
		expect(credentialsFor(unknownUrl, undefined, apiHosts, cookieHosts)).toBeUndefined();
	});
});
