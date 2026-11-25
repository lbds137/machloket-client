import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {addInstance, recordRequests} from "./test/setup";

// Migrating existing sessions to the cookie (TASK-150, docs/design/token-storage.md "Migrating
// existing sessions" and "401 handling"): the migration at start, and a header account's 401
// whose cookie probe finds the session moved. Same bootstrap order as the other suites.
const {Localuser} = await import("./localuser");
const {migrateToCookieSession, onCookieSessionAdopted, adduser, runPendingLogouts} =
	await import("./utils/utils");
const {apiFetch, resetUnauthorizedNavForTests} = await import("./utils/apiFetch");
const {buildAccountHeaders, cookieModeHosts, CSRF_HEADER} = await import("./utils/accountHeaders");
const {pageNav} = await import("./invite");
const {readItem, resetSettingOverlayForTests} = await import("./utils/storage/settingOverlay");

const saved = localStorage.getItem("userinfos");
beforeEach(() => {
	localStorage.setItem("userinfos", JSON.stringify({currentuser: null, users: {}}));
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	resetUnauthorizedNavForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
	if (saved === null) localStorage.removeItem("userinfos");
	else localStorage.setItem("userinfos", saved);
	resetSettingOverlayForTests();
});

function stored() {
	return JSON.parse(localStorage.getItem("userinfos")!) as {
		users: Record<string, any>;
		pendingLogouts?: Record<string, string>;
	};
}
function urlsFor(origin: string, authCookie?: boolean) {
	return {
		api: origin + "/api/v9",
		cdn: origin,
		gateway: origin.replace(/^http/, "ws"),
		wellknown: origin,
		...(authCookie !== undefined && {authCookie}),
	};
}
function headerAccount(origin: string, email: string, authCookie?: boolean, id = "id-" + email) {
	return adduser({serverurls: urlsFor(origin, authCookie), email, token: "tok-" + email, id});
}
const unauthorized = () => Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
const noContent = () => new Response(null, {status: 204});

describe("the migration at start", () => {
	it("moves a header session into the cookie on a 204: the record keeps no token", async () => {
		addInstance("http://mig-ok.test", 0, {authCookie: true});
		const exchanges = recordRequests("http://mig-ok.test/api/v9/auth/session-cookie", noContent);
		const user = headerAccount("http://mig-ok.test", "ok@x");

		await migrateToCookieSession(user);

		expect(exchanges).toHaveLength(1);
		expect(exchanges[0].headers.get("Authorization")).toBe("tok-ok@x");
		expect(exchanges[0].headers.get("X-Machloket-Auth")).toBe("cookie");
		expect(exchanges[0].headers.get(CSRF_HEADER)).toBe("1");
		expect(exchanges[0].credentials).toBe("include");
		expect(user.authMode).toBe("cookie");
		expect(user.token).toBeUndefined();
		expect(buildAccountHeaders(user).Authorization).toBeUndefined();
		const record = stored().users[user.uid];
		expect(record.auth_mode).toBe("cookie");
		expect("token" in record).toBe(false);
		expect(record.loggedin).toBe(true);
	});

	it.each([403, 409, 502])("keeps the header account on a %i", async (status) => {
		const origin = `http://mig-refused-${status}.test`;
		addInstance(origin, 0, {authCookie: true});
		recordRequests(origin + "/api/v9/auth/session-cookie", () =>
			Response.json({message: "no", code: 0}, {status}),
		);
		const user = headerAccount(origin, "refused@x");

		await migrateToCookieSession(user);

		expect(user.authMode).toBeUndefined();
		expect(user.token).toBe("tok-refused@x");
		expect(stored().users[user.uid].token).toBe("tok-refused@x");
		expect(stored().users[user.uid].loggedin).toBe(true);
	});

	it("keeps the header account when the exchange gets no answer", async () => {
		addInstance("http://mig-silent.test", 0, {authCookie: true});
		recordRequests("http://mig-silent.test/api/v9/auth/session-cookie", () => {
			throw new TypeError("Failed to fetch");
		});
		const user = headerAccount("http://mig-silent.test", "silent@x");

		await migrateToCookieSession(user);

		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].token).toBe("tok-silent@x");
	});

	it("doesn't ask when the instance's discovery doesn't offer cookie sessions", async () => {
		addInstance("http://mig-stock.test", 0);
		const exchanges = recordRequests("http://mig-stock.test/api/v9/auth/session-cookie");
		const user = headerAccount("http://mig-stock.test", "stock@x", true);

		await migrateToCookieSession(user);

		expect(exchanges).toHaveLength(0);
		expect(user.authMode).toBeUndefined();
		// The fresh answer replaces the stored flag.
		expect(stored().users[user.uid].serverurls.authCookie).toBe(false);
	});

	it("migrates an account logged in before the instance turned cookie mode on", async () => {
		addInstance("http://mig-turned-on.test", 0, {authCookie: true});
		const exchanges = recordRequests(
			"http://mig-turned-on.test/api/v9/auth/session-cookie",
			noContent,
		);
		const user = headerAccount("http://mig-turned-on.test", "late@x", false);

		await migrateToCookieSession(user);

		expect(exchanges).toHaveLength(1);
		expect(stored().users[user.uid].serverurls.authCookie).toBe(true);
		expect(stored().users[user.uid].auth_mode).toBe("cookie");
	});

	it("doesn't ask when a logged-in cookie account holds the hostname's cookie, any port", async () => {
		addInstance("http://mig-held.test:8080", 0, {authCookie: true});
		const exchanges = recordRequests("http://mig-held.test:8080/api/v9/auth/session-cookie");
		adduser({
			serverurls: urlsFor("http://mig-held.test:9090", true),
			email: "c@x",
			auth_mode: "cookie",
		});
		const user = headerAccount("http://mig-held.test:8080", "second@x");

		await migrateToCookieSession(user);

		expect(exchanges).toHaveLength(0);
		expect(user.authMode).toBeUndefined();
	});

	it.each([
		["a cookie account", {auth_mode: "cookie"}],
		["a logged-out account", {token: "t", loggedin: false}],
	])("doesn't touch %s", async (_name, fields) => {
		addInstance("http://mig-skip.test", 0, {authCookie: true});
		const exchanges = recordRequests("http://mig-skip.test/api/v9/auth/session-cookie");
		const user = adduser({
			serverurls: urlsFor("http://mig-skip.test", true),
			email: "s@x",
			...fields,
		});

		await migrateToCookieSession(user);

		expect(exchanges).toHaveLength(0);
	});

	it("runs after the host's pending logout, and its 204 clears one that the retry left", async () => {
		addInstance("http://mig-pending.test", 0, {authCookie: true});
		const order: string[] = [];
		recordRequests("http://mig-pending.test/api/v9/auth/logout", async () => {
			order.push("logout");
			await new Promise((r) => setTimeout(r, 50));
			// A refusal keeps the entry: the cookie may still be live.
			return Response.json({message: "no", code: 0}, {status: 403});
		});
		recordRequests("http://mig-pending.test/api/v9/auth/session-cookie", () => {
			order.push("exchange");
			return noContent();
		});
		const user = headerAccount("http://mig-pending.test", "pending@x");
		const info = stored();
		info.pendingLogouts = {"mig-pending.test": "http://mig-pending.test/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));

		const retries = runPendingLogouts();
		await migrateToCookieSession(user);
		await retries;

		expect(order).toEqual(["logout", "exchange"]);
		expect(stored().pendingLogouts ?? {}).toEqual({});
		expect(stored().users[user.uid].auth_mode).toBe("cookie");
	});

	it("keeps the converted record for this session when the store refuses the save", async () => {
		addInstance("http://mig-full.test", 0, {authCookie: true});
		recordRequests("http://mig-full.test/api/v9/auth/session-cookie", noContent);
		const user = headerAccount("http://mig-full.test", "full@x");
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key) {
			if (this === localStorage && key === "userinfos") {
				throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
			}
		});

		await migrateToCookieSession(user);

		expect(user.authMode).toBe("cookie");
		// The stored record keeps the now-dead token; the next start's 401 probe converts it.
		expect(stored().users[user.uid].token).toBe("tok-full@x");
		const session = JSON.parse(readItem("userinfos")!).users[user.uid];
		expect(session.auth_mode).toBe("cookie");
		expect("token" in session).toBe(false);
	});

	it("converts on a 401 whose cookie probe answers the same user (another tab migrated it)", async () => {
		addInstance("http://mig-other-tab.test", 0, {authCookie: true});
		recordRequests("http://mig-other-tab.test/api/v9/auth/session-cookie", unauthorized);
		const probes = recordRequests("http://mig-other-tab.test/api/v9/users/@me", () =>
			Response.json({id: "id-tab@x"}),
		);
		const user = headerAccount("http://mig-other-tab.test", "tab@x");

		await migrateToCookieSession(user);

		expect(probes).toHaveLength(1);
		expect(probes[0].headers.get("Authorization")).toBeNull();
		expect(probes[0].headers.get(CSRF_HEADER)).toBe("1");
		expect(probes[0].credentials).toBe("include");
		expect(user.authMode).toBe("cookie");
		expect(stored().users[user.uid].auth_mode).toBe("cookie");
	});

	it("doesn't convert on a 401 whose cookie probe answers another user", async () => {
		addInstance("http://mig-other-user.test", 0, {authCookie: true});
		recordRequests("http://mig-other-user.test/api/v9/auth/session-cookie", unauthorized);
		recordRequests("http://mig-other-user.test/api/v9/users/@me", () =>
			Response.json({id: "someone-else"}),
		);
		const user = headerAccount("http://mig-other-user.test", "mine@x");

		await migrateToCookieSession(user);

		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].token).toBe("tok-mine@x");
	});
});

describe("a header account's 401 on a cookie-mode host", () => {
	/** A tagged request that 401s, whose token probe (with Authorization) answers 401, and whose
	 * cookie probe (without it) answers `cookie()`. */
	function arrange(origin: string, cookie: () => Response) {
		recordRequests(origin + "/api/v9/users/@me/settings", unauthorized);
		// The responder runs only once a request arrives, after `probes` is assigned.
		const probes = recordRequests(origin + "/api/v9/users/@me", () =>
			probes.at(-1)!.headers.get("Authorization") ? unauthorized() : cookie(),
		);
		return probes;
	}
	async function send401(user: {uid: string}, origin: string) {
		await apiFetch(origin + "/api/v9/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(user as never),
			body: "{}",
		});
	}

	it("converts the record to a cookie account instead of logging it out when the cookie is the same user's", async () => {
		const origin = "http://probe-same.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const adopted: string[] = [];
		const listener = {cookieSessionAdopted: (uid: string) => adopted.push(uid)};
		onCookieSessionAdopted(listener);
		const user = headerAccount(origin, "same@x", true);
		// This tab never saw the host's discovery: only the store knows it offers cookie sessions.
		cookieModeHosts.delete("probe-same.test");
		const probes = arrange(origin, () => Response.json({id: "id-same@x"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(user.authMode).toBe("cookie"));
		expect(probes.map((p) => p.headers.get("Authorization"))).toEqual(["tok-same@x", null]);
		expect(probes[1].credentials).toBe("include");
		expect(stored().users[user.uid].auth_mode).toBe("cookie");
		expect("token" in stored().users[user.uid]).toBe(false);
		expect(stored().users[user.uid].loggedin).toBe(true);
		expect(adopted).toEqual([user.uid]);
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
	});

	it("logs out when the cookie answers for another user", async () => {
		const origin = "http://probe-other.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "other@x", true);
		arrange(origin, () => Response.json({id: "someone-else"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].loggedin).toBe(false);
	});

	it("logs out without converting when the record has no user id to compare", async () => {
		const origin = "http://probe-noid.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({serverurls: urlsFor(origin, true), email: "noid@x", token: "tok-noid"});
		arrange(origin, () => Response.json({id: "anything"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		expect(user.authMode).toBeUndefined();
	});

	it("leaves the account alone when the cookie probe gets no answer", async () => {
		const origin = "http://probe-silent.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "silent@x", true);
		const probes = arrange(origin, () => {
			throw new TypeError("Failed to fetch");
		});

		await send401(user, origin);

		await vi.waitFor(() => expect(probes).toHaveLength(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].loggedin).toBe(true);
	});

	it.each([429, 503])(
		"leaves the account alone when the cookie probe answers %i (no verdict)",
		async (status) => {
			const origin = `http://probe-busy-${status}.test`;
			const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
			const user = headerAccount(origin, "busy@x", true);
			const probes = arrange(origin, () => Response.json({message: "busy"}, {status}));

			await send401(user, origin);

			await vi.waitFor(() => expect(probes).toHaveLength(2));
			await new Promise((r) => setTimeout(r, 0));
			expect(nav).not.toHaveBeenCalled();
			expect(user.authMode).toBeUndefined();
			expect(stored().users[user.uid].loggedin).toBe(true);
		},
	);

	it("leaves the account alone when the cookie probe's 200 isn't JSON (a proxy page)", async () => {
		const origin = "http://probe-html.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "html@x", true);
		const probes = arrange(
			origin,
			() => new Response("<html>gateway</html>", {headers: {"content-type": "text/html"}}),
		);

		await send401(user, origin);

		await vi.waitFor(() => expect(probes).toHaveLength(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(stored().users[user.uid].loggedin).toBe(true);
	});

	it("doesn't convert while a logout is pending on the hostname: the cookie is to end", async () => {
		const origin = "http://probe-pending.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "pending@x", true);
		const info = stored();
		info.pendingLogouts = {"probe-pending.test": origin + "/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
		arrange(origin, () => Response.json({id: "id-pending@x"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		expect(user.authMode).toBeUndefined();
		expect(stored().pendingLogouts).toEqual({"probe-pending.test": origin + "/api/v9"});
	});

	it("doesn't convert a copy whose stored record holds a newer login", async () => {
		const origin = "http://probe-newer.test";
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "newer@x", true);
		const info = stored();
		info.users[user.uid].token = "tok-newer";
		localStorage.setItem("userinfos", JSON.stringify(info));
		const probes = arrange(origin, () => Response.json({id: "id-newer@x"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(probes).toHaveLength(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].token).toBe("tok-newer");
		expect(stored().users[user.uid].auth_mode).toBeUndefined();
	});

	it("sends no cookie probe on a host that doesn't offer cookie sessions", async () => {
		const origin = "http://probe-stock.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "stock@x");
		const probes = arrange(origin, () => Response.json({id: "id-stock@x"}));

		await send401(user, origin);

		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		expect(probes).toHaveLength(1);
	});
});

describe("Localuser after its session moved into the cookie", () => {
	function liveUser(origin: string) {
		const user = headerAccount(origin, "live@x", true);
		const l = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
		l.userinfo = user;
		l.headers = buildAccountHeaders(user);
		return {l, user};
	}

	it("switches its live headers to the cookie in place, so the gateway sends no token", () => {
		const {l, user} = liveUser("http://live-headers.test");
		const headers = l.headers;
		user.json.auth_mode = "cookie";
		delete user.json.token;
		(user as {token?: string}).token = undefined;

		l.cookieSessionAdopted(user.uid);

		expect(l.headers).toBe(headers);
		expect(headers.Authorization).toBeUndefined();
		expect(headers[CSRF_HEADER]).toBe("1");
		expect(l.token).toBeUndefined();
	});

	it("reconnects when the gateway had closed on the dead token (4004)", () => {
		const {l, user} = liveUser("http://live-4004.test");
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		vi.spyOn(l, "loaduser").mockImplementation(() => {});
		vi.spyOn(l, "init").mockResolvedValue(undefined as never);
		l.awaitingAuthVerdict = true;
		user.json.auth_mode = "cookie";

		l.cookieSessionAdopted(user.uid);

		expect(reconnect).toHaveBeenCalledTimes(1);
		expect(l.awaitingAuthVerdict).toBe(false);
	});

	it("reconnects on a 4004 for a token it no longer sends (moved into the cookie meanwhile)", () => {
		const {l, user} = liveUser("http://live-moved.test");
		l.info = user.serverurls;
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		recordRequests("http://live-moved.test/api/v9/users/@me", () =>
			Response.json({id: "id-live@x"}),
		);
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		vi.spyOn(l, "loaduser").mockImplementation(() => {});
		vi.spyOn(l, "init").mockResolvedValue(undefined as never);
		l.identifiedToken = "tok-live@x";
		user.json.auth_mode = "cookie";
		delete user.json.token;
		(user as {token?: string}).token = undefined;
		l.cookieSessionAdopted(user.uid); // a REST 401 converted it before the close arrived
		expect(reconnect).not.toHaveBeenCalled();

		l.gatewayAuthFailed();

		expect(reconnect).toHaveBeenCalledTimes(1);
		expect(l.awaitingAuthVerdict).toBe(false);
	});

	it("waits for the 401 path's verdict on a 4004 for the token it still sends", () => {
		const {l, user} = liveUser("http://live-same.test");
		l.info = user.serverurls;
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		recordRequests("http://live-same.test/api/v9/users/@me", () =>
			Response.json({id: "id-live@x"}),
		);
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		l.identifiedToken = "tok-live@x";

		l.gatewayAuthFailed();

		expect(reconnect).not.toHaveBeenCalled();
		expect(l.awaitingAuthVerdict).toBe(true);
	});

	it("ignores another account's adoption", () => {
		const {l} = liveUser("http://live-other.test");
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		l.awaitingAuthVerdict = true;

		l.cookieSessionAdopted("someone-else");

		expect(reconnect).not.toHaveBeenCalled();
		expect(l.headers.Authorization).toBe("tok-live@x");
	});
});
