import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {addInstance, recordRequests, withoutWebLocks} from "./test/setup";

// Migrating existing sessions to the cookie (TASK-150, docs/design/token-storage.md "Migrating
// existing sessions" and "401 handling"): the migration at start, and a header account's 401
// whose cookie probe finds the session moved. Same bootstrap order as the other suites.
const {Localuser} = await import("./localuser");
const {
	migrateToCookieSession,
	startCookieMigration,
	onCookieSessionAdopted,
	adduser,
	runPendingLogouts,
} = await import("./utils/utils");
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

	it("doesn't ask without Web Locks: the session stays on the token", async () => {
		addInstance("http://mig-nolocks.test", 0, {authCookie: true});
		const exchanges = recordRequests(
			"http://mig-nolocks.test/api/v9/auth/session-cookie",
			noContent,
		);
		const user = headerAccount("http://mig-nolocks.test", "nolocks@x");
		const warn = vi.spyOn(console, "warn");

		await withoutWebLocks(() => migrateToCookieSession(user));

		expect(exchanges).toHaveLength(0);
		// The guard stopped it, not a lock call that threw and was caught (it would warn).
		expect(warn).not.toHaveBeenCalled();
		expect(user.token).toBe("tok-nolocks@x");
		// With the locks back the same account migrates: the run above held it, not the account.
		await migrateToCookieSession(user);
		expect(exchanges).toHaveLength(1);
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

	/** Discovery that answers only when the test says so. */
	function heldDiscovery(origin: string) {
		let answer!: (authCookie: boolean) => void;
		const answered = new Promise<boolean>((res) => (answer = res));
		recordRequests(origin + "/api/v9/policies/instance/domains", async () =>
			Response.json({api: origin + "/api/", authCookie: await answered}),
		);
		return answer;
	}
	/** "started" when `beforeStart` settles within 200 ms, "held" otherwise. */
	function startState(beforeStart: Promise<void>) {
		return Promise.race([
			beforeStart.then(() => "started"),
			new Promise((res) => setTimeout(() => res("held"), 200)),
		]);
	}

	it("starts at once when the record says no cookie sessions; the flag refreshes behind it", async () => {
		const origin = "http://mig-bg.test";
		addInstance(origin, 0, {authCookie: true});
		const answer = heldDiscovery(origin);
		const exchanges = recordRequests(origin + "/api/v9/auth/session-cookie", noContent);
		const user = headerAccount(origin, "bg@x", false);

		const {beforeStart, done} = startCookieMigration(user);

		expect(await startState(beforeStart)).toBe("started");
		answer(true);
		await done;
		// The exchange waits for the next start, before its gateway: this one's socket is live.
		expect(exchanges).toHaveLength(0);
		expect(user.token).toBe("tok-bg@x");
		expect(stored().users[user.uid].serverurls.authCookie).toBe(true);
		expect(stored().users[user.uid].token).toBe("tok-bg@x");
		expect(cookieModeHosts.has("mig-bg.test")).toBe(true);
	});

	/** Rewrites the stored record of `uid` (another tab's write, or a logout's removal). */
	function storeRecord(uid: string, change: (record: any) => any) {
		const info = stored();
		const next = change(info.users[uid]);
		if (next === undefined) delete info.users[uid];
		else info.users[uid] = next;
		localStorage.setItem("userinfos", JSON.stringify(info));
	}

	it.each([
		["removed", () => undefined],
		["logged out", (record: any) => ({...record, loggedin: false})],
		["replaced by a newer login", (record: any) => ({...record, token: "tok-newer"})],
	])(
		"doesn't write over a record %s while its background discovery was out (flag false)",
		async (name, change) => {
			const origin = `http://mig-bg-${name.replace(/\W/g, "-")}.test`;
			addInstance(origin, 0, {authCookie: true});
			const answer = heldDiscovery(origin);
			const user = headerAccount(origin, "gone@x", false);

			const {done} = startCookieMigration(user);
			storeRecord(user.uid, change); // another tab, meanwhile
			const meanwhile = stored().users[user.uid];
			answer(true);
			await done;

			expect(stored().users[user.uid]).toEqual(meanwhile);
		},
	);

	it.each([
		["unset", undefined],
		["false", false],
	])(
		"doesn't overwrite a record another tab moved into the cookie during discovery (flag %s)",
		async (_name, flag) => {
			const origin = `http://mig-moved-${String(flag)}.test`;
			addInstance(origin, 0, {authCookie: true});
			const answer = heldDiscovery(origin);
			recordRequests(origin + "/api/v9/auth/session-cookie", unauthorized);
			const user = headerAccount(origin, "moved@x", flag);

			const {done} = startCookieMigration(user);
			storeRecord(user.uid, (record) => {
				const {token: _dead, ...rest} = record;
				return {...rest, auth_mode: "cookie"};
			});
			answer(true);
			await done;

			const record = stored().users[user.uid];
			expect(record.auth_mode).toBe("cookie");
			expect("token" in record).toBe(false);
		},
	);

	it.each([
		["removed", () => undefined],
		["logged out", (record: any) => ({...record, loggedin: false})],
		["replaced by a newer login", (record: any) => ({...record, token: "tok-newer"})],
	])("sends no exchange for a record %s during discovery (flag true)", async (name, change) => {
		const origin = `http://mig-true-${name.replace(/\W/g, "-")}.test`;
		addInstance(origin, 0, {authCookie: true});
		const answer = heldDiscovery(origin);
		const exchanges = recordRequests(origin + "/api/v9/auth/session-cookie", noContent);
		const user = headerAccount(origin, "true@x", true);

		const {done} = startCookieMigration(user);
		storeRecord(user.uid, change);
		answer(true);
		await done;

		expect(exchanges).toHaveLength(0);
	});

	it.each([
		["removed", () => undefined],
		["logged out", (record: any) => ({...record, loggedin: false})],
		["replaced by a newer login", (record: any) => ({...record, token: "tok-newer"})],
		[
			"replaced by a cookie login on another api host",
			(record: any) => ({
				...record,
				token: undefined,
				auth_mode: "cookie",
				serverurls: urlsFor("http://moved-api.test", true),
			}),
		],
	])(
		"doesn't adopt a 204 for a record %s while the exchange was out: its cookie is logged out",
		async (name, change) => {
			const origin = `http://mig-204-${name.replace(/\W/g, "-")}.test`;
			addInstance(origin, 0, {authCookie: true});
			const user = headerAccount(origin, "late@x", true);
			let meanwhile: unknown;
			recordRequests(origin + "/api/v9/auth/session-cookie", () => {
				storeRecord(user.uid, change); // another tab, while the exchange is out
				meanwhile = stored().users[user.uid];
				return noContent();
			});
			const logouts = recordRequests(origin + "/api/v9/auth/logout");

			await migrateToCookieSession(user);

			expect(stored().users[user.uid]).toEqual(meanwhile);
			expect(user.authMode).toBeUndefined();
			// The exchange ended the header session; its cookie now belongs to no account.
			await vi.waitFor(() => expect(logouts).toHaveLength(1));
			expect(logouts[0].headers.get("Authorization")).toBeNull();
			expect(logouts[0].credentials).toBe("include");
			await vi.waitFor(() => expect(stored().pendingLogouts ?? {}).toEqual({}));
		},
	);

	it("logs the orphaned cookie out before a cookie login queued behind the exchange starts", async () => {
		const origin = "http://mig-204-orphan-queued.test";
		addInstance(origin, 0, {authCookie: true});
		const user = headerAccount(origin, "queued@x", true);
		const order: string[] = [];
		let release!: () => void;
		let queued!: Promise<unknown>;
		recordRequests(origin + "/api/v9/auth/session-cookie", () => {
			storeRecord(user.uid, () => undefined); // another tab's logout
			// A cookie login queues on the slot's lock while the exchange holds it, and takes the
			// login's hold once it gets the lock, as cookieOptIn does.
			queued = navigator.locks.request(
				"machloket-cookie-session:mig-204-orphan-queued.test",
				() => {
					order.push("login");
					// Keeps the slot's lock until the hold is taken, as cookieOptIn does.
					return new Promise<void>((taken) => {
						void navigator.locks.request(
							"machloket-cookie-login:mig-204-orphan-queued.test",
							() => {
								taken();
								return new Promise<void>((r) => (release = r));
							},
						);
					});
				},
			);
			return noContent();
		});
		const logouts = recordRequests(origin + "/api/v9/auth/logout", () => {
			order.push("logout");
			return noContent();
		});

		try {
			await migrateToCookieSession(user);
			await queued;

			// The login would go out with the orphaned cookie still live, and the server keeps a
			// live cookie over a login's opt-in; the logout comes first.
			expect(order).toEqual(["logout", "login"]);
			expect(logouts).toHaveLength(1);
			expect(stored().pendingLogouts ?? {}).toEqual({});
		} finally {
			release?.();
		}
	});

	it("keeps the orphaned cookie's logout pending when it gets no answer", async () => {
		const origin = "http://mig-204-orphan-down.test";
		addInstance(origin, 0, {authCookie: true});
		const user = headerAccount(origin, "orphan@x", true);
		recordRequests(origin + "/api/v9/auth/session-cookie", () => {
			storeRecord(user.uid, () => undefined);
			return noContent();
		});
		const logouts = recordRequests(
			origin + "/api/v9/auth/logout",
			() => new Response(null, {status: 503}),
		);

		await migrateToCookieSession(user);

		await vi.waitFor(() => expect(logouts).toHaveLength(1));
		expect(stored().pendingLogouts).toEqual({"mig-204-orphan-down.test": origin + "/api/v9"});
		expect(stored().users[user.uid]).toBeUndefined();
	});

	it("doesn't re-add a record removed while its 401's cookie probe was out", async () => {
		const origin = "http://mig-401-removed.test";
		addInstance(origin, 0, {authCookie: true});
		recordRequests(origin + "/api/v9/auth/session-cookie", unauthorized);
		const user = headerAccount(origin, "gone401@x", true);
		const probes = recordRequests(origin + "/api/v9/users/@me", () => {
			storeRecord(user.uid, () => undefined); // another tab's logout
			return Response.json({id: "id-gone401@x"});
		});

		await migrateToCookieSession(user);

		expect(probes).toHaveLength(1);
		expect(stored().users[user.uid]).toBeUndefined();
		expect(user.authMode).toBeUndefined();
	});

	it("doesn't adopt on a 401 when the record moved to a cookie login on another API host meanwhile", async () => {
		const origin = "http://mig-401-moved.test";
		addInstance(origin, 0, {authCookie: true});
		const user = headerAccount(origin, "moved401@x", true);
		let moved: unknown;
		recordRequests(origin + "/api/v9/auth/session-cookie", () => {
			// Another tab's cookie login for the same account, after the instance's API moved.
			storeRecord(user.uid, (record) => ({
				...record,
				token: undefined,
				auth_mode: "cookie",
				serverurls: urlsFor("http://moved-api.test", true),
			}));
			moved = stored().users[user.uid];
			return unauthorized();
		});
		const probes = recordRequests(origin + "/api/v9/users/@me", () =>
			Response.json({id: "id-moved401@x"}),
		);

		await migrateToCookieSession(user);

		expect(probes).toHaveLength(1);
		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid]).toEqual(moved);
	});

	it("sends no exchange while a cookie login on the hostname is out (another tab's)", async () => {
		const origin = "http://mig-login-out.test";
		addInstance(origin, 0, {authCookie: true});
		const exchanges = recordRequests(origin + "/api/v9/auth/session-cookie", noContent);
		const user = headerAccount(origin, "waiting@x", true);
		// The login's hold, as another tab's cookie login (waiting on a second factor) holds it.
		let release!: () => void;
		let taken!: () => void;
		const isTaken = new Promise<void>((r) => (taken = r));
		const hold = navigator.locks.request("machloket-cookie-login:mig-login-out.test", () => {
			taken();
			return new Promise<void>((r) => (release = r));
		});
		await isTaken;

		try {
			await migrateToCookieSession(user);

			expect(exchanges).toHaveLength(0);
			expect(user.token).toBe("tok-waiting@x");
		} finally {
			release();
			await hold;
		}
		// The login settled: the next start migrates.
		await migrateToCookieSession(user);
		expect(exchanges).toHaveLength(1);
	});

	it.each([
		["unset", undefined],
		["true", true],
	])("holds the start on discovery when the record's flag is %s", async (_name, flag) => {
		const origin = `http://mig-hold-${String(flag)}.test`;
		addInstance(origin, 0, {authCookie: true});
		const answer = heldDiscovery(origin);
		const exchanges = recordRequests(origin + "/api/v9/auth/session-cookie", noContent);
		const user = headerAccount(origin, "hold@x", flag);

		const {beforeStart, done} = startCookieMigration(user);

		expect(await startState(beforeStart)).toBe("held");
		answer(true);
		await beforeStart;
		expect(exchanges).toHaveLength(1);
		expect(stored().users[user.uid].auth_mode).toBe("cookie");
		await done;
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

	it("logs out without Web Locks, sending no cookie probe: no cookie session is adopted there", async () => {
		const origin = "http://probe-nolocks.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "nolocks401@x", true);
		const probes = arrange(origin, () => Response.json({id: "id-nolocks401@x"}));

		// Awaited inside: the 401 path runs after apiFetch answers.
		await withoutWebLocks(async () => {
			await send401(user, origin);
			await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		});

		expect(probes.map((p) => p.headers.get("Authorization"))).toEqual(["tok-nolocks401@x"]);
		expect(user.authMode).toBeUndefined();
		expect(stored().users[user.uid].loggedin).toBe(false);
	});

	it("doesn't re-add an account another tab removed while the cookie probe was out", async () => {
		const origin = "http://probe-removed.test";
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = headerAccount(origin, "removed401@x", true);
		const probes = arrange(origin, () => {
			const info = stored();
			delete info.users[user.uid]; // another tab's logout
			localStorage.setItem("userinfos", JSON.stringify(info));
			return Response.json({id: "id-removed401@x"});
		});

		await send401(user, origin);

		// The 401 path's last step: everything before it has settled.
		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
		expect(probes).toHaveLength(2);
		expect(stored().users[user.uid]).toBeUndefined();
		expect(user.authMode).toBeUndefined();
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
		// Object.create skips the class-field initializers the 4004 retry reads.
		l.gatewayAuthAttempt = 0;
		l.gatewayAuthRetried = false;
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

	it("waits for the 401 path's verdict on a 4004 for the token it still sends", async () => {
		const {l, user} = liveUser("http://live-same.test");
		l.info = user.serverurls;
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		recordRequests("http://live-same.test/api/v9/users/@me", () =>
			Response.json({id: "id-live@x"}),
		);
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		vi.spyOn(l, "loaduser").mockImplementation(() => {});
		vi.spyOn(l, "init").mockResolvedValue(undefined as never);
		l.identifiedToken = "tok-live@x";

		l.gatewayAuthFailed();

		expect(reconnect).not.toHaveBeenCalled();
		expect(l.awaitingAuthVerdict).toBe(true);
		// The probe finds the session alive: IDENTIFY is retried once on its own (TASK-157).
		await vi.waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
		expect(l.awaitingAuthVerdict).toBe(false);
	});

	for (const [name, upFor, retries] of [
		[
			"a connection that stayed up 20 s re-arms the spent automatic retry and restarts the backoff",
			21_000,
			true,
		],
		["a connection up for less than 20 s re-arms neither", 1_000, false],
	] as const) {
		it(`${name} (TASK-173)`, async () => {
			const host = `http://live-rearm-${upFor}.test`;
			const {l, user} = liveUser(host);
			l.info = user.serverurls;
			vi.spyOn(pageNav, "go").mockImplementation(() => {});
			recordRequests(host + "/api/v9/users/@me", () => Response.json({id: "id-live@x"}));
			const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
			vi.spyOn(l, "loaduser").mockImplementation(() => {});
			vi.spyOn(l, "init").mockResolvedValue(undefined as never);
			const retry = document.createElement("button");
			retry.id = "gatewayRetry";
			retry.hidden = true;
			document.body.append(retry);
			try {
				l.identifiedToken = "tok-live@x";
				l.gatewayAuthRetried = true; // An earlier 4004 spent the automatic retry.
				l.connectionSucceed = Date.now() - upFor;
				l.errorBackoff = 1; // The drop before this socket had started the backoff.

				l.gatewayAuthFailed();

				expect(l.errorBackoff).toBe(retries ? 0 : 1);

				if (retries) {
					await vi.waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
					expect(retry.hidden).toBe(true);
				} else {
					await vi.waitFor(() => expect(retry.hidden).toBe(false));
					expect(reconnect).not.toHaveBeenCalled();
				}
				// Measured once: the next connection's 20 s count starts from its own ACK.
				expect(l.connectionSucceed).toBe(0);
			} finally {
				retry.remove();
			}
		});
	}

	it("a verdict landing after an adoption's reconnect connects no second time (TASK-157)", async () => {
		const {l, user} = liveUser("http://live-race.test");
		l.info = user.serverurls;
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		let answer!: (r: Response) => void;
		const probes = recordRequests(
			"http://live-race.test/api/v9/users/@me",
			() => new Promise<Response>((r) => (answer = r)),
		);
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();
		vi.spyOn(l, "loaduser").mockImplementation(() => {});
		vi.spyOn(l, "init").mockResolvedValue(undefined as never);
		l.identifiedToken = "tok-live@x";

		l.gatewayAuthFailed();
		await vi.waitFor(() => expect(probes).toHaveLength(1));
		// Another tab's migration converts the account while the probe is out: it reconnects.
		user.json.auth_mode = "cookie";
		l.cookieSessionAdopted(user.uid);
		expect(reconnect).toHaveBeenCalledTimes(1);

		answer(Response.json({id: "id-live@x"}));
		await new Promise((r) => setTimeout(r, 50));
		expect(reconnect).toHaveBeenCalledTimes(1);
		expect(l.gatewayAuthRetried).toBe(false);
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
