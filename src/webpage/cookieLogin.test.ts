import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {addInstance, recordRequests} from "./test/setup";
import type {Specialuser as SpecialuserT} from "./utils/utils";

// Cookie sessions (TASK-149, docs/design/token-storage.md): discovery's authCookie, the opt-in
// on login, register and both MFA steps, the token-less account, logout and the pending logout.
// Same bootstrap order as the other suites: localuser first.
const {Localuser} = await import("./localuser");
const {Options} = await import("./settings");
const {getapiurls, keepAuthCookie, Specialuser, runPendingLogouts, adduser} =
	await import("./utils/utils");
const {cookieModeHosts} = await import("./utils/accountHeaders");
const {makeLogin} = await import("./login");
const {makeRegister} = await import("./register");
const {I18n} = await import("./i18n");

const saved = localStorage.getItem("userinfos");
beforeEach(() => {
	localStorage.removeItem("instanceinfo");
	localStorage.setItem("userinfos", JSON.stringify({currentuser: null, users: {}}));
});
afterEach(() => {
	if (saved === null) localStorage.removeItem("userinfos");
	else localStorage.setItem("userinfos", saved);
	document.querySelectorAll("dialog, .background").forEach((e) => e.remove());
});

function stored() {
	return JSON.parse(localStorage.getItem("userinfos")!) as {
		currentuser: string | null;
		users: Record<string, any>;
		pendingLogouts?: Record<string, string>;
	};
}

function urlsFor(origin: string) {
	return {
		api: origin + "/api/v9",
		cdn: origin,
		gateway: origin.replace(/^http/, "ws"),
		wellknown: origin,
	};
}

/** Stores an account on `origin` straight into userinfos and returns it. */
function storeAccount(origin: string, email: string, mode: "cookie" | "header", loggedin = true) {
	const u = new Specialuser({
		serverurls: {...urlsFor(origin), authCookie: true},
		email,
		...(mode === "cookie" ? {auth_mode: "cookie"} : {token: "tok-" + email}),
		loggedin,
	});
	const info = stored();
	info.users[u.uid] = u.toJSON();
	localStorage.setItem("userinfos", JSON.stringify(info));
	return u;
}

/** The newest match: earlier tests leave their dialogs in the document. */
function newest<T extends Element>(selector: string) {
	const all = document.querySelectorAll<T>(selector);
	return all[all.length - 1];
}

async function pickInstance(value: string) {
	const input = newest<HTMLInputElement>('input[list="instances"]');
	input.value = value;
	input.dispatchEvent(new Event("input"));
	await vi.waitUntil(
		() => JSON.parse(localStorage.getItem("instanceinfo") ?? "null")?.api === value + "/api/v9",
		{timeout: 2000},
	);
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {"Content-Type": "application/json"},
	});
}

describe("discovery's authCookie", () => {
	it("is kept on the instance's urls when discovery offers cookie sessions", async () => {
		addInstance("http://offers.test", 0, {authCookie: true});
		const urls = await getapiurls("http://offers.test");
		expect(urls?.authCookie).toBe(true);
		expect(cookieModeHosts.has("offers.test")).toBe(true);
	});

	it("is false when discovery answers without it", async () => {
		addInstance("http://stock.test", 0);
		const urls = await getapiurls("http://stock.test");
		expect(urls?.authCookie).toBe(false);
		expect(cookieModeHosts.has("stock.test")).toBe(false);
	});

	it("is left out when discovery doesn't answer, so a refresh keeps the stored flag", async () => {
		addInstance("http://silent.test", 0);
		recordRequests(
			"http://silent.test/api/v9/policies/instance/domains",
			() => new Response("nope", {status: 502}),
		);
		const urls = await getapiurls("http://silent.test");
		expect(urls).not.toBeNull();
		expect(urls && "authCookie" in urls).toBe(false);
	});
});

describe("login's cookie opt-in", () => {
	it("asks for a cookie session when discovery offers one, and stores the account without a token", async () => {
		addInstance("http://cookie-login.test", 0, {authCookie: true});
		const logins = recordRequests("http://cookie-login.test/api/v9/auth/login", () =>
			json({auth_mode: "cookie", user_id: "1"}),
		);
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://cookie-login.test");
		newest<HTMLInputElement>('input[name="login"], input').value = "c@x";
		newest<HTMLButtonElement>("button.createAccount").click();
		const user = await loggedIn;

		expect(logins).toHaveLength(1);
		expect(logins[0].headers.get("X-Machloket-Auth")).toBe("cookie");
		expect(logins[0].headers.get("X-Machloket-CSRF")).toBe("1");
		expect(logins[0].credentials).toBe("include");
		expect(user.authMode).toBe("cookie");
		expect(user.token).toBeUndefined();
		const record = stored().users[user.uid];
		expect(record.auth_mode).toBe("cookie");
		expect("token" in record).toBe(false);
	});

	it("doesn't opt in when discovery doesn't offer cookie sessions", async () => {
		addInstance("http://plain-login.test", 0);
		const logins = recordRequests("http://plain-login.test/api/v9/auth/login", () =>
			json({token: "plain-token"}),
		);
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://plain-login.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		const user = await loggedIn;

		expect(logins[0].headers.get("X-Machloket-Auth")).toBeNull();
		expect(logins[0].headers.get("X-Machloket-CSRF")).toBeNull();
		expect(user.token).toBe("plain-token");
		expect(user.authMode).toBeUndefined();
	});

	it("doesn't opt in while a logged-in cookie account exists on that host", async () => {
		addInstance("http://taken.test", 0, {authCookie: true});
		storeAccount("http://taken.test", "first@x", "cookie");
		const logins = recordRequests("http://taken.test/api/v9/auth/login", () =>
			json({token: "second-token"}),
		);
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://taken.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		const user = await loggedIn;

		expect(logins[0].headers.get("X-Machloket-Auth")).toBeNull();
		expect(user.token).toBe("second-token");
	});

	it("opts in again once the host's cookie account is logged out", async () => {
		addInstance("http://freed.test", 0, {authCookie: true});
		storeAccount("http://freed.test", "old@x", "cookie", false);
		const logins = recordRequests("http://freed.test/api/v9/auth/login", () =>
			json({auth_mode: "cookie"}),
		);
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://freed.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		await loggedIn;

		expect(logins[0].headers.get("X-Machloket-Auth")).toBe("cookie");
	});

	it("stores a header account when the server ignores the opt-in and answers a token", async () => {
		addInstance("http://ignored.test", 0, {authCookie: true});
		recordRequests("http://ignored.test/api/v9/auth/login", () => json({token: "body-token"}));
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://ignored.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		const user = await loggedIn;

		expect(user.token).toBe("body-token");
		expect(user.authMode).toBeUndefined();
	});

	it("sends the opt-in on the TOTP step of a login that asked for a second factor", async () => {
		addInstance("http://mfa.test", 0, {authCookie: true});
		recordRequests("http://mfa.test/api/v9/auth/login", () =>
			json({ticket: "tk", mfa: true, totp: true}),
		);
		const steps = recordRequests("http://mfa.test/api/v9/auth/mfa/totp", () =>
			json({auth_mode: "cookie"}),
		);
		const addForm = vi.spyOn(Options.prototype, "addForm");
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://mfa.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		await vi.waitUntil(() =>
			addForm.mock.calls.some((c) =>
				(c[2] as {fetchURL?: string})?.fetchURL?.endsWith("/mfa/totp"),
			),
		);
		const codeForm = addForm.mock.results.at(-1)!.value as {submit(): Promise<void>};
		await codeForm.submit();
		const user = await loggedIn;
		addForm.mockRestore();

		expect(steps).toHaveLength(1);
		expect(steps[0].headers.get("X-Machloket-Auth")).toBe("cookie");
		expect(steps[0].headers.get("X-Machloket-CSRF")).toBe("1");
		expect(steps[0].credentials).toBe("include");
		expect(user.authMode).toBe("cookie");
	});

	it("waits for the host's pending logout before it asks for a cookie", async () => {
		addInstance("http://waits.test", 0, {authCookie: true});
		const info = stored();
		info.pendingLogouts = {"waits.test": "http://waits.test/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
		const order: string[] = [];
		let releaseLogout!: () => void;
		const logoutHeld = new Promise<void>((r) => (releaseLogout = r));
		recordRequests("http://waits.test/api/v9/auth/logout", async () => {
			order.push("logout sent");
			await logoutHeld;
			order.push("logout answered");
			return new Response(null, {status: 204});
		});
		recordRequests("http://waits.test/api/v9/auth/login", () => {
			order.push("login sent");
			return json({auth_mode: "cookie"});
		});
		const retry = runPendingLogouts();
		const loggedIn = new Promise<SpecialuserT>((res) => makeLogin(false, "", res));
		await pickInstance("http://waits.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		await vi.waitUntil(() => order.includes("logout sent"));
		releaseLogout();
		await retry;
		await loggedIn;

		expect(order).toEqual(["logout sent", "logout answered", "login sent"]);
	});
});

describe("register's cookie opt-in", () => {
	it("asks for a cookie session and stores the account without a token", async () => {
		addInstance("http://cookie-reg.test", 0, {authCookie: true});
		const regs = recordRequests("http://cookie-reg.test/api/v9/auth/register", () =>
			json({auth_mode: "cookie"}),
		);
		const addForm = vi.spyOn(Options.prototype, "addForm");
		const registered = new Promise<SpecialuserT>((res) =>
			makeRegister(false, "http://cookie-reg.test", res),
		);
		await pickInstance("http://cookie-reg.test");
		const form = addForm.mock.results.at(-1)!.value as {submit(): Promise<void>};
		addForm.mockRestore();
		// Register's own gates pass: the two (empty) passwords match; the terms box gets ticked.
		const terms = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(
			-1,
		)!;
		terms.checked = true;
		await form.submit();
		const user = await registered;

		expect(regs[0].headers.get("X-Machloket-Auth")).toBe("cookie");
		expect(regs[0].headers.get("X-Machloket-CSRF")).toBe("1");
		expect(user.authMode).toBe("cookie");
		expect(user.token).toBeUndefined();
	});
});

describe("logout", () => {
	it("treats a 401 as logged out: the account goes, with no error dialog", async () => {
		const u = storeAccount("http://dead.test", "d@x", "cookie");
		recordRequests("http://dead.test/api/v9/auth/logout", () => new Response(null, {status: 401}));

		expect(await u.logout()).toBe(true);
		expect(stored().users[u.uid]).toBeUndefined();
		expect(stored().pendingLogouts?.["dead.test"]).toBeUndefined();
	});

	async function failThenContinue(u: SpecialuserT) {
		const done = u.logout();
		await vi.waitUntil(
			() =>
				[...document.querySelectorAll("button")].find(
					(b) => b.textContent === I18n.logout.error.cont(),
				),
			{timeout: 5000},
		);
		[...document.querySelectorAll("button")]
			.find((b) => b.textContent === I18n.logout.error.cont())!
			.click();
		return done;
	}

	it("records a pending logout when a cookie account's logout fails and it is removed anyway", async () => {
		const u = storeAccount("http://flaky.test", "f@x", "cookie");
		recordRequests("http://flaky.test/api/v9/auth/logout", () => new Response(null, {status: 500}));

		expect(await failThenContinue(u)).toBe(true);
		expect(stored().users[u.uid]).toBeUndefined();
		expect(stored().pendingLogouts?.["flaky.test"]).toBe("http://flaky.test/api/v9");
		expect(cookieModeHosts.has("flaky.test")).toBe(true);
	});

	it("records none for a header account's failed logout", async () => {
		const u = storeAccount("http://flaky-h.test", "h@x", "header");
		recordRequests(
			"http://flaky-h.test/api/v9/auth/logout",
			() => new Response(null, {status: 500}),
		);

		expect(await failThenContinue(u)).toBe(true);
		expect(stored().pendingLogouts?.["flaky-h.test"]).toBeUndefined();
	});
});

describe("the pending logout at start", () => {
	function pending(host: string) {
		const info = stored();
		info.pendingLogouts = {...info.pendingLogouts, [host]: "http://" + host + "/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
	}

	it("retries by cookie, with no Authorization, and a 204 ends it", async () => {
		pending("retry.test");
		const sent = recordRequests("http://retry.test/api/v9/auth/logout");
		await runPendingLogouts();

		expect(sent).toHaveLength(1);
		expect(sent[0].headers.get("Authorization")).toBeNull();
		expect(sent[0].headers.get("X-Machloket-CSRF")).toBe("1");
		expect(sent[0].credentials).toBe("include");
		expect(stored().pendingLogouts?.["retry.test"]).toBeUndefined();
	});

	it("a 401 ends it too", async () => {
		pending("gone.test");
		recordRequests("http://gone.test/api/v9/auth/logout", () => new Response(null, {status: 401}));
		await runPendingLogouts();
		expect(stored().pendingLogouts?.["gone.test"]).toBeUndefined();
	});

	it("an unanswered retry stays for the next start", async () => {
		pending("down.test");
		recordRequests("http://down.test/api/v9/auth/logout", () => new Response(null, {status: 503}));
		await runPendingLogouts();
		expect(stored().pendingLogouts?.["down.test"]).toBe("http://down.test/api/v9");
	});

	it("is dropped unsent when a logged-in cookie account holds that host's cookie", async () => {
		storeAccount("http://held.test", "k@x", "cookie");
		pending("held.test");
		const sent = recordRequests("http://held.test/api/v9/auth/logout");
		await runPendingLogouts();

		expect(sent).toHaveLength(0);
		expect(stored().pendingLogouts?.["held.test"]).toBeUndefined();
	});

	it("is dropped by a newer cookie login on that host", () => {
		pending("relogin.test");
		adduser({serverurls: urlsFor("http://relogin.test"), email: "n@x", auth_mode: "cookie"});
		expect(stored().pendingLogouts?.["relogin.test"]).toBeUndefined();
	});
});

describe("a header login replacing the same account's cookie record", () => {
	it("records a pending logout, so the orphaned cookie is ended", () => {
		const old = storeAccount("http://swap.test", "s@x", "cookie");
		const fresh = adduser({serverurls: urlsFor("http://swap.test"), email: "s@x", token: "t2"});
		expect(fresh.uid).toBe(old.uid);
		expect(stored().pendingLogouts?.["swap.test"]).toBe("http://swap.test/api/v9");
	});
});

describe("the gateway for a cookie account", () => {
	const RealWebSocket = globalThis.WebSocket;
	let FakeWebSocket: typeof import("./test/gateway").FakeWebSocket;
	let gatewayUser: typeof import("./test/gateway").gatewayUser;
	beforeEach(async () => {
		({FakeWebSocket, gatewayUser} = await import("./test/gateway"));
		FakeWebSocket.sockets = [];
		globalThis.WebSocket = FakeWebSocket as never;
	});
	afterEach(() => {
		globalThis.WebSocket = RealWebSocket;
	});

	it("sends IDENTIFY with no token key", () => {
		const user = gatewayUser();
		Object.defineProperty(user, "token", {value: undefined});
		user.initwebsocket();
		const ws = FakeWebSocket.sockets.at(-1)!;
		ws.emit("open", {});
		const identify = ws.sent.find((m) => m.op === 2) as {d: Record<string, unknown>};
		expect("token" in identify.d).toBe(false);
	});

	it("sends RESUME with no token key", () => {
		const user = gatewayUser();
		Object.defineProperty(user, "token", {value: undefined});
		user.session_id = "s1";
		user.resume_gateway_url = "wss://gw.test";
		user.initwebsocket(true);
		const ws = FakeWebSocket.sockets.at(-1)!;
		ws.emit("open", {});
		const resume = ws.sent.find((m) => m.op === 6) as {d: Record<string, unknown>};
		expect(resume).toBeDefined();
		expect("token" in resume.d).toBe(false);
	});

	it("keeps READY's auth_token out of a cookie account", () => {
		const u = storeAccount("http://ready.test", "r@x", "cookie");
		const lu = Object.assign(Object.create(Localuser.prototype), {
			userinfo: u,
			headers: {"X-Machloket-CSRF": "1"},
		});
		lu.adoptReadyToken("leaked");
		expect(u.token).toBeUndefined();
		expect("token" in u.json).toBe(false);
		expect(lu.headers.Authorization).toBeUndefined();
	});

	it("still adopts READY's auth_token for a header account", () => {
		const u = storeAccount("http://ready-h.test", "rh@x", "header");
		const lu = Object.assign(Object.create(Localuser.prototype), {
			userinfo: u,
			headers: {Authorization: u.token},
		});
		lu.adoptReadyToken("rotated");
		expect(u.token).toBe("rotated");
		expect(lu.headers.Authorization).toBe("rotated");
	});
});

describe("review round 1", () => {
	it("a cookie login demotes another logged-in cookie account on the same hostname, any port", () => {
		const older = storeAccount("http://slot.test:3001", "a@x", "cookie");
		const newer = adduser({
			serverurls: {...urlsFor("http://slot.test:3002"), authCookie: true},
			email: "b@x",
			auth_mode: "cookie",
		});
		// One browser cookie per hostname: it is the newer login's now.
		expect(stored().users[older.uid].loggedin).toBe(false);
		expect(stored().users[older.uid].auth_mode).toBeUndefined();
		expect(stored().users[newer.uid].auth_mode).toBe("cookie");
	});

	it("a header login over a live cookie record records the replaced record's API base", () => {
		const old = new Specialuser({
			serverurls: {...urlsFor("http://moved.test"), api: "http://moved.test/old/api/v9"},
			email: "m@x",
			auth_mode: "cookie",
			loggedin: true,
		});
		const info = stored();
		info.users[old.uid] = old.toJSON();
		localStorage.setItem("userinfos", JSON.stringify(info));
		adduser({serverurls: urlsFor("http://moved.test"), email: "m@x", token: "t"});
		expect(stored().pendingLogouts?.["moved.test"]).toBe("http://moved.test/old/api/v9");
	});

	it("a 403 keeps the pending logout: the cookie may still be live", async () => {
		const info = stored();
		info.pendingLogouts = {"forbid.test": "http://forbid.test/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
		recordRequests(
			"http://forbid.test/api/v9/auth/logout",
			() => new Response(null, {status: 403}),
		);
		await runPendingLogouts();
		expect(stored().pendingLogouts?.["forbid.test"]).toBe("http://forbid.test/api/v9");
	});

	it("the retry sends to the entry's API base as stored when it runs, and clears only that entry", async () => {
		const info = stored();
		info.pendingLogouts = {"swap.test": "http://swap.test/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
		const sent = recordRequests("http://swap.test/api/v9/auth/logout", () => {
			// Written while the request is out: a newer entry for the host.
			const now = stored();
			now.pendingLogouts = {"swap.test": "http://swap.test/v2/api/v9"};
			localStorage.setItem("userinfos", JSON.stringify(now));
			return new Response(null, {status: 204});
		});
		await runPendingLogouts();
		expect(sent).toHaveLength(1);
		expect(stored().pendingLogouts?.["swap.test"]).toBe("http://swap.test/v2/api/v9");
	});

	it("a cookie logout that fails removes the account and records its pending logout in one write", async () => {
		const u = storeAccount("http://order.test", "o@x", "cookie");
		recordRequests("http://order.test/api/v9/auth/logout", () => new Response(null, {status: 500}));
		const done = u.logout();
		await vi.waitFor(() => expect(newest("button")).toBeTruthy());
		// Every store state another tab could read: none may hold the live account and the
		// pending logout together, or that tab's retry would drop the entry as superseded.
		const writes: string[] = [];
		const realSetItem = Storage.prototype.setItem;
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
			this: Storage,
			key: string,
			value: string,
		) {
			if (this === localStorage && key === "userinfos") writes.push(value);
			realSetItem.call(this, key, value);
		});
		[...document.querySelectorAll("button")]
			.filter((b) => b.textContent === I18n.logout.error.cont())
			.at(-1)!
			.click();
		await done;
		setItem.mockRestore();
		expect(writes).toHaveLength(1);
		const after = JSON.parse(writes[0]);
		expect(after.users[u.uid]).toBeUndefined();
		expect(after.pendingLogouts?.["order.test"]).toBe("http://order.test/api/v9");
	});

	it("a cookie login for the same account on a new API hostname orphans the old hostname's cookie", () => {
		const old = storeAccount("http://old-api.test", "h@x", "cookie");
		// Same uid (email + wellknown); the instance's API moved to another hostname.
		adduser({
			serverurls: {
				...urlsFor("http://new-api.test"),
				wellknown: old.serverurls.wellknown,
				authCookie: true,
			},
			email: "h@x",
			auth_mode: "cookie",
		});
		expect(stored().pendingLogouts?.["old-api.test"]).toBe("http://old-api.test/api/v9");
	});

	it("keepAuthCookie keeps the stored flag when discovery didn't answer, and takes a fresh one", () => {
		const base: import("./utils/utils").InstanceUrls = urlsFor("http://k.test");
		expect(keepAuthCookie({...base}, {...base, authCookie: true}).authCookie).toBe(true);
		expect(
			keepAuthCookie({...base, authCookie: false}, {...base, authCookie: true}).authCookie,
		).toBe(false);
	});

	it("a rejected retry doesn't stall a cookie login on its host", async () => {
		const info = stored();
		info.pendingLogouts = {"reject.test": "http://reject.test/api/v9"};
		localStorage.setItem("userinfos", JSON.stringify(info));
		const locks = navigator.locks;
		Object.defineProperty(navigator, "locks", {
			configurable: true,
			value: {request: () => Promise.reject(new Error("lock failed"))},
		});
		try {
			await expect(runPendingLogouts()).resolves.toBeUndefined();
		} finally {
			Object.defineProperty(navigator, "locks", {configurable: true, value: locks});
		}
	});
});
