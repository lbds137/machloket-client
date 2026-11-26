import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests, recordRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Channel} = await import("./channel");
const {Guild} = await import("./guild");
const {User} = await import("./user");
const {Direct} = await import("./direct");
const {Discovery} = await import("./discovery");
const {ReportMenu} = await import("./reporting/report");
const {Command} = await import("./interactions/commands");
const {Permissions} = await import("./permissions");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
const {pageNav, acceptInvite} = await import("./invite");
const {fetchRetryOnce} = await import("./utils/rateLimit");
const {
	API_TIMEOUT_MS,
	apiFetch,
	configureApiXhr,
	handleUnauthorized,
	isPreAuthEndpoint,
	noteActiveAccount,
	probeUnauthorized,
	resetUnauthorizedNavForTests,
} = await import("./utils/apiFetch");
const {CSRF_HEADER, accountUidOf, applyAccountHeaders, buildAccountHeaders} =
	await import("./utils/accountHeaders");
const {showNewInvite} = await import("./utils/inviteLink");
const {adduser, Specialuser, SW, pingResponse, getApiUrlsV2} = await import("./utils/utils");
const {saveProfile} = await import("./utils/profileSave");
const {exportUserData} = await import("./utils/dataExport");
const {authorizeBot} = await import("./oauth2/botInvite");
const {readItem, resetSettingOverlayForTests} = await import("./utils/storage/settingOverlay");
const {Member} = await import("./member");
const {Message, sendForward, fetchReactionUsers} = await import("./message.js");
const {API: FIXTURE_API, messageIn} = await import("./test/interactionFixture");
await I18n.done;

const API = "http://apifetch.test/api/v9";
const savedUserinfos = localStorage.getItem("userinfos");

beforeEach(() => {
	if (savedUserinfos !== null) localStorage.setItem("userinfos", savedUserinfos);
	else localStorage.removeItem("userinfos");
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	resetUnauthorizedNavForTests();
	document
		.querySelectorAll("dialog, .PopUp, .background, .commandError, #realbox")
		.forEach((e) => e.remove());
});

afterEach(() => {
	vi.restoreAllMocks();
	// No vi.unstubAllGlobals here: test/setup's fetch interceptor is a module-scope stub this
	// file's captureRequests calls depend on, and unstubbing it after the first test sends
	// every later request to the real network (the "offline" failure class).
	if (savedUserinfos !== null) localStorage.setItem("userinfos", savedUserinfos);
	else localStorage.removeItem("userinfos");
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	for (const id of [
		"channelTopic",
		"loadingdiv",
		"scrollWrap",
		"channels",
		"servertd",
		"serverName",
		"realbox",
	]) {
		document.getElementById(id)?.remove();
	}
	document
		.querySelectorAll("dialog, .PopUp, .background, .commandError")
		.forEach((e) => e.remove());
	if (realAbortSignalAny) Object.defineProperty(AbortSignal, "any", realAbortSignalAny);
});

/** The real XHR, captured before any test stubs it, so stubbing tests can hand it back. */
const realXHR = globalThis.XMLHttpRequest;
const realAbortSignalAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");

describe("apiFetch wrapper", () => {
	it("401 marks the account invalid and routes once despite several parallel 401s", async () => {
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "revoked@example.test",
			token: "fake-revoked-token",
			loggedin: true,
		});
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const unauthorized = () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/invites/abc", unauthorized);
		captureRequests(API + "/channels/c1/invites", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);

		const headers = buildAccountHeaders(user);
		await Promise.all([
			fetchRetryOnce(API + "/users/@me/settings", {
				method: "PATCH",
				headers,
				body: JSON.stringify({status: "idle"}),
			}),
			acceptInvite(API, "abc", headers),
			showNewInvite(
				API + "/channels/c1/invites",
				headers,
				{max_age: 0, max_uses: 0},
				"http://apifetch.test",
				document.createElement("span"),
			),
		]);

		// The 401 path is probe-verified now: the invalidation and navigation land a few
		// microtasks after the refused response, so wait for the navigation, then assert state.
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
		expect(
			(JSON.parse(readItem("userinfos")!) as {users: Record<string, {loggedin?: boolean}>}).users[
				user.uid
			].loggedin,
		).toBe(false);
	});

	it("401 invalidation respects save-refusal semantics and exempts pre-auth endpoints", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = new Specialuser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "quota-401@example.test",
			token: "fake-quota-token",
			loggedin: true,
		});
		user.tryUpdateLocal();

		// Pre-auth endpoints (/ping, /auth/login) must not invalidate or route on 401.
		captureRequests(API + "/ping", () => new Response(null, {status: 401}));
		captureRequests(API + "/auth/login", () =>
			Response.json({message: "Invalid login"}, {status: 401}),
		);
		await fetchRetryOnce(API + "/ping");
		await fetchRetryOnce(API + "/auth/login", {method: "POST", body: "{}"});
		expect(user.loggedin).toBe(true);
		expect(nav).toHaveBeenCalledTimes(0);

		// Full storage refuses both the full account write and the fallback fields write.
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
		});
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({status: "dnd"}),
		});

		// Probe-verified: wait for the navigation before reading the invalidation's side effects.
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));

		expect(user.loggedin).toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("timeout triggers the offline refusal path without waiting 30 s (fetch and XHR)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const realTimeout = AbortSignal.timeout.bind(AbortSignal);
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockImplementation((ms) => realTimeout(Math.min(ms, 25)));
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			return new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(init.signal?.reason ?? new DOMException("timed out", "TimeoutError")),
					{once: true},
				);
			});
		});
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {Authorization: "fake-token"},
			relChangeUpdateMap: new Map(),
		}) as InstanceType<typeof Localuser>;
		const target = Object.assign(Object.create(User.prototype), {
			id: "u2",
			owner: localuser,
		}) as InstanceType<typeof User>;

		const outcome = await Promise.race([
			target.changeRelationship(1).then(() => "settled"),
			new Promise<string>((r) => setTimeout(() => r("hung"), 250)),
		]);

		expect(outcome).toBe("settled");
		expect(timeoutSpy).toHaveBeenCalledWith(30_000);
		expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());

		// Form.doFetch timeout also releases inFlight and shows the offline refusal.
		const form = new Dialog("").options.addForm("", () => {}, {
			fetchURL: API + "/users/@me/settings",
			api: API,
			method: "PATCH",
			headers: {Authorization: "fake-token"},
		});
		const formOutcome = await Promise.race([
			form.submit().then(() => "settled"),
			new Promise<string>((r) => setTimeout(() => r("hung"), 250)),
		]);
		expect(formOutcome).toBe("settled");
		expect(document.body.textContent).toContain(I18n.requestFailed("offline"));

		// XHR send configures xhr.timeout = 30_000 and fails the bubble on ontimeout.
		let configuredTimeout = 0;
		vi.stubGlobal(
			"XMLHttpRequest",
			class {
				status = 0;
				response: unknown = null;
				responseType = "";
				timeout = 0;
				upload = {onprogress: null};
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				ontimeout: (() => void) | null = null;
				open() {}
				setRequestHeader() {}
				send() {
					configuredTimeout = this.timeout;
					queueMicrotask(() => this.ontimeout?.());
				}
			},
		);
		const bubble = {progress: vi.fn(), failed: vi.fn(), void: vi.fn()};
		const sendChannel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}},
			headers: {"Content-type": "application/json", Authorization: "fake-token"},
			makeFakeMessage: vi.fn(async () => bubble),
			slowmode: vi.fn(),
		}) as InstanceType<typeof Channel>;
		void sendChannel.sendMessage("hello", {nonce: "n-timeout"});
		await vi.waitFor(() => expect(bubble.failed).toHaveBeenCalledTimes(1));
		expect(configuredTimeout).toBe(30_000);
		// Hand the real XHR back: the stub must not leak into the tests after this one.
		vi.stubGlobal("XMLHttpRequest", realXHR);
	});

	it("sends fetches with redirect: 'error'", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({code: "abc", guild_id: "g1"}));

		await acceptInvite(API, "abc", {Authorization: "fake-token"});

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({redirect: "error"});
	});

	it("a form whose payload carries an upload (a data: URL) submits untimed; other forms keep the budget", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
		const submitForm = (values: Record<string, unknown>) => {
			// A values-function stands in for the FileInput: both land the same data: string in
			// the built payload (the reader.result branch in settings.ts).
			const form = new Dialog("").options.addForm("", () => {}, {
				fetchURL: API + "/users/@me/settings",
				api: API,
				method: "PATCH",
				headers: {Authorization: "fake-token"},
			});
			for (const [key, value] of Object.entries(values)) form.setValue(key, value);
			return form.submit();
		};

		await submitForm({avatar: () => "data:image/png;base64,AAAA"});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1]?.signal).toBeUndefined();

		await submitForm({bio: () => "plain text"});
		expect(fetchSpy.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());
	});

	it("the pre-auth exemption covers instance discovery, instance policies, and 2FA subpaths", () => {
		expect(isPreAuthEndpoint(API + "/.well-known/spacebar/client")).toBe(true);
		expect(isPreAuthEndpoint(API + "/policies/instance/domains")).toBe(true);
		expect(isPreAuthEndpoint(API + "/auth/mfa/totp")).toBe(true);
		expect(isPreAuthEndpoint(API + "/auth/mfa")).toBe(true);
		expect(isPreAuthEndpoint(API + "/auth/login")).toBe(true);
		expect(isPreAuthEndpoint(API + "/ping")).toBe(true);
		expect(isPreAuthEndpoint(API + "/users/@me")).toBe(false);
	});

	it("only the token-matching account is invalidated; a token-less 401 acts on nothing", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const serverurls = {
			api: API,
			cdn: "http://apifetch.test",
			gateway: "ws://apifetch.test",
			wellknown: "http://apifetch.test",
		};
		const a = adduser({
			serverurls,
			email: "acct-a@example.test",
			token: "fake-token-a",
			loggedin: true,
		});
		const b = adduser({
			serverurls,
			email: "acct-b@example.test",
			token: "fake-token-b",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(b),
			body: JSON.stringify({status: "idle"}),
		});
		// Probe-verified: wait for the navigation before reading the invalidation's side effects.
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(a.loggedin).toBe(true);
		expect(b.loggedin).toBe(false);

		// The same endpoint 401s a request with no Authorization header: nothing happens.
		await fetchRetryOnce(API + "/users/@me/settings");
		expect(a.loggedin).toBe(true);
		expect(nav).toHaveBeenCalledTimes(1);
	});

	it("a wrong-password 401 on an authorized form endpoint does not log the account out", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const serverurls = {
			api: API,
			cdn: "http://apifetch.test",
			gateway: "ws://apifetch.test",
			wellknown: "http://apifetch.test",
		};
		const user = adduser({
			serverurls,
			email: "wrongpw@example.test",
			token: "fake-wrongpw-token",
			loggedin: true,
		});
		// The delete endpoint (like /disable and the TOTP verify) answers its own bare 401 for
		// a wrong password while the token is still valid: the auth-middleware probe
		// (GET /users/@me) must confirm the token is dead before the account is invalidated.
		captureRequests(API + "/users/@me/delete", () =>
			Response.json({message: "Wrong password"}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => Response.json({id: "u-alive"}));

		await fetchRetryOnce(API + "/users/@me/delete", {
			method: "POST",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({password: "nope"}),
		});

		await vi.waitFor(() => expect(nav).not.toHaveBeenCalled());
		expect(user.loggedin).toBe(true);
		expect(
			(JSON.parse(readItem("userinfos")!) as {users: Record<string, {loggedin?: boolean}>}).users[
				user.uid
			].loggedin,
		).toBe(true);
	});

	it("401s in separate macrotasks still navigate once", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "latch@example.test",
			token: "fake-latch-token",
			loggedin: true,
		});
		const unauthorized = () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);

		await fetchRetryOnce(API + "/users/@me/settings", {
			headers: buildAccountHeaders(user),
		});
		await new Promise((r) => setTimeout(r, 0));
		await fetchRetryOnce(API + "/users/@me", {
			headers: buildAccountHeaders(user),
		});

		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
	});

	it("configureApiXhr opts the attachment upload out of the timeout", () => {
		const timed = new XMLHttpRequest();
		configureApiXhr(timed, () => {});
		expect(timed.timeout).toBe(30_000);
		const untimed = new XMLHttpRequest();
		configureApiXhr(untimed, () => {}, 0);
		expect(untimed.timeout).toBe(0);
	});

	it("a 401 on a post-auth URL without a /vN segment fails closed without probing or logging out", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: "http://apifetch.test",
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "novn@example.test",
			token: "fake-novn-token",
			loggedin: true,
		});
		let probes = 0;
		captureRequests("http://apifetch.test/users/@me", () => {
			probes++;
			return Response.json({id: "u-alive"});
		});
		captureRequests("http://apifetch.test/users/@me/delete", () =>
			Response.json({message: "Wrong password"}, {status: 401}),
		);

		await fetchRetryOnce("http://apifetch.test/users/@me/delete", {
			method: "POST",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({password: "nope"}),
		});

		expect(probes).toBe(0);
		expect(user.loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();
	});

	it("a failed probe (network error) releases the latch so a later 401 with a dead token still navigates", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "probe-reject@example.test",
			token: "fake-probe-reject-token",
			loggedin: true,
		});
		let probes = 0;
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => {
			if (probes++ === 0) throw new TypeError("Failed to fetch");
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});

		await fetchRetryOnce(API + "/users/@me/settings", {
			headers: buildAccountHeaders(user),
		});
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(user.loggedin).toBe(true);

		await fetchRetryOnce(API + "/users/@me/settings", {
			headers: buildAccountHeaders(user),
		});
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
	});

	it("alive-then-dies: a 200 probe releases the latch so a later 401 with a dead probe invalidates and navigates once", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "alive-then-dies@example.test",
			token: "fake-alive-then-dies-token",
			loggedin: true,
		});
		let tokenDead = false;
		let probes = 0;
		captureRequests(API + "/users/@me/delete", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => {
			probes++;
			return tokenDead
				? Response.json({message: "401: Unauthorized", code: 0}, {status: 401})
				: Response.json({id: "u-alive"});
		});

		await fetchRetryOnce(API + "/users/@me/delete", {
			method: "POST",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({password: "nope"}),
		});
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(user.loggedin).toBe(true);

		tokenDead = true;
		await fetchRetryOnce(API + "/users/@me/delete", {
			method: "POST",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({password: "nope"}),
		});
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
	});

	it("probeUnauthorized settles every run with its verdict; a held latch hands back that run (TASK-157)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "probe-verdict@example.test",
			token: "fake-probe-verdict-token",
			loggedin: true,
		});
		const answers: (() => Response)[] = [
			() => Response.json({id: "u-alive"}),
			() => Response.json({message: "Service unavailable", code: 0}, {status: 503}),
			() => Response.json({message: "Too many requests", code: 0}, {status: 429}),
			() => Response.json({message: "Forbidden", code: 0}, {status: 403}),
			// A proxy's maintenance page: a 200 that is no verdict about the session.
			() =>
				new Response("<html>under maintenance</html>", {
					status: 200,
					headers: {"content-type": "text/html"},
				}),
			() => {
				throw new TypeError("Failed to fetch");
			},
			() => Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		];
		let probes = 0;
		captureRequests(API + "/users/@me", () => answers[probes++]());
		const probe = () => probeUnauthorized(API + "/users/@me", {headers: buildAccountHeaders(user)});

		// Alive: the check answered and kept the session (the Retry state says so, TASK-172).
		// 5xx, 429, a proxy's 403, a proxy's HTML page and a network error: the check went
		// unanswered, validity unconfirmed. None is a verdict of death; each releases the latch.
		const expectedVerdicts = [
			"notDead",
			"unanswered",
			"unanswered",
			"unanswered",
			"unanswered",
			"unanswered",
		] as const;
		for (let i = 0; i < 6; i++) {
			const run = probe();
			if (!run) throw new Error("the path did not engage");
			expect(await run).toBe(expectedVerdicts[i]);
		}
		expect(user.loggedin).toBe(true);

		const dying = probe();
		// While that run is out, the account's latch hands back the same run, not a new probe.
		expect(probe()).toBe(dying);
		expect(await dying).toBe("dead");
		expect(user.loggedin).toBe(false);
		// The confirmed death keeps the latch until the /login navigation: still "dead".
		expect(await probe()).toBe("dead");
		expect(probes).toBe(7);
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));

		// A pre-auth or untagged request never engages.
		expect(probeUnauthorized(API + "/auth/login", {headers: buildAccountHeaders(user)})).toBe(
			undefined,
		);
		expect(probeUnauthorized(API + "/users/@me", {headers: {Authorization: "x"}})).toBe(undefined);
	});

	it("AbortSignal.any fallback still rejects with the offline DOMException when a caller signal is present and fetch hangs", async () => {
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, init) =>
				new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const controller = new AbortController();

		const err = await apiFetch(API + "/users/@me", {
			signal: controller.signal,
			timeoutMs: 25,
		}).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(DOMException);
		expect(err).toMatchObject({name: "TimeoutError", message: "offline"});
	}, 2_000);

	it("AbortSignal.any fallback: a timeout removes its listener from the caller's signal", async () => {
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, init) =>
				new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const callerSignal = new AbortController().signal;
		const added = vi.spyOn(callerSignal, "addEventListener");
		const removed = vi.spyOn(callerSignal, "removeEventListener");

		await apiFetch(API + "/users/@me", {signal: callerSignal, timeoutMs: 25}).catch(() => {});

		// A long-lived caller signal (a page's) must not keep one listener per timed-out request.
		expect(added).toHaveBeenCalledTimes(1);
		expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
	}, 2_000);

	it("caller abort rejects with the caller's custom reason", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, init) =>
				new Promise<Response>((_, reject) => {
					if (init?.signal?.aborted) {
						reject(init.signal.reason);
						return;
					}
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		const reason = new Error("caller cancelled");
		const controller = new AbortController();
		const pending = apiFetch(API + "/users/@me", {signal: controller.signal});
		controller.abort(reason);
		await expect(pending).rejects.toBe(reason);

		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		const fallbackReason = new Error("fallback caller cancelled");
		const fallbackController = new AbortController();
		const fallbackPending = apiFetch(API + "/users/@me", {signal: fallbackController.signal});
		fallbackController.abort(fallbackReason);
		await expect(fallbackPending).rejects.toBe(fallbackReason);
	});

	it("a caller signal aborted before the call rejects immediately on the fallback path", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, init) =>
				new Promise<Response>((_, reject) => {
					if (init?.signal?.aborted) {
						reject(init.signal.reason);
						return;
					}
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				}),
		);
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		const reason = new Error("aborted before the call");
		const controller = new AbortController();
		controller.abort(reason);
		await expect(apiFetch(API + "/users/@me", {signal: controller.signal})).rejects.toBe(reason);
	});

	it("AbortSignal.any fallback: a caller abort after the headers still cancels a slow body read", async () => {
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(streamController) {
							init?.signal?.addEventListener(
								"abort",
								() => streamController.error(init.signal?.reason),
								{once: true},
							);
						},
					}),
					{status: 200},
				),
			),
		);
		const callerController = new AbortController();
		const res = await apiFetch(API + "/guilds/g1/bans", {signal: callerController.signal});
		const outcome = Promise.race([
			res
				.body!.getReader()
				.read()
				.then(
					() => "resolved",
					() => "rejected",
				),
			new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 500)),
		]);
		callerController.abort();
		expect(await outcome).toBe("rejected");
	});

	it("AbortSignal.any fallback: a timeout during the body read rejects it with the TimeoutError reason", async () => {
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(streamController) {
							init?.signal?.addEventListener(
								"abort",
								() => streamController.error(init.signal?.reason),
								{once: true},
							);
						},
					}),
					{status: 200},
				),
			),
		);
		const res = await apiFetch(API + "/guilds/g1/bans", {
			signal: new AbortController().signal,
			timeoutMs: 50,
		});
		const error = await res
			.body!.getReader()
			.read()
			.then(
				() => null,
				(e: unknown) => e,
			);
		expect((error as DOMException | null)?.name).toBe("TimeoutError");
	});

	it("guild unban 401 with a dead-token probe invalidates the stored account and routes to /login", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "unban-dead@example.test",
			token: "fake-unban-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/guilds/g1/bans/u1", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		const guild = Object.assign(Object.create(Guild.prototype), {
			id: "g1",
			owner: {info: {api: API}},
			headers: buildAccountHeaders(user),
		}) as InstanceType<typeof Guild>;

		expect(await guild.unban("u1")).toBe(false);

		await vi.waitFor(() => {
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("guild unban 401 with a 200 probe keeps the account logged in and shows the refusal", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "unban-alive@example.test",
			token: "fake-unban-alive-token",
			loggedin: true,
		});
		captureRequests(API + "/guilds/g1/bans/u1", () =>
			Response.json({message: "Unban refused", code: 0}, {status: 401}),
		);
		let probes = 0;
		captureRequests(API + "/users/@me", () => {
			probes++;
			return Response.json({id: "u-alive"});
		});
		const guild = Object.assign(Object.create(Guild.prototype), {
			id: "g1",
			owner: {info: {api: API}},
			headers: buildAccountHeaders(user),
		}) as InstanceType<typeof Guild>;

		expect(await guild.unban("u1")).toBe(false);
		// The 401 must reach the probe (apiFetch engaged), and the probe's "alive" must settle.
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));

		expect(nav).not.toHaveBeenCalled();
		expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(true);
		expect(document.body.textContent).toContain(I18n.requestFailed("Unban refused"));
	});

	it("ProgessiveDecodeJSON through apiFetch sends redirect: 'error' and decodes the served array", async () => {
		const {ProgessiveDecodeJSON} = await import("./utils/progessiveLoad");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify([{code: "a"}, {code: "b"}]), {status: 200}));

		const prog = await ProgessiveDecodeJSON<{code: string}[]>(
			API + "/guilds/g1/invites",
			{headers: {Authorization: "fake-progressive-token"}},
			apiFetch,
		);
		const whole = await (prog as unknown as {getWhole: () => Promise<unknown>}).getWhole();

		expect(fetchSpy.mock.calls[0][1]).toMatchObject({redirect: "error"});
		expect(whole).toEqual([{code: "a"}, {code: "b"}]);
	});

	it("ProgressiveArray close() on the AbortSignal.any fallback aborts a slow body read", async () => {
		const {ProgressiveArray} = await import("./utils/progessiveLoad");
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(streamController) {
							streamController.enqueue(new TextEncoder().encode('[{"code":"a"}'));
							init?.signal?.addEventListener(
								"abort",
								() => streamController.error(init.signal?.reason),
								{once: true},
							);
						},
					}),
					{status: 200},
				),
			),
		);
		const prog = new ProgressiveArray(
			API + "/guilds/g1/bans",
			{headers: {Authorization: "fake-close-token"}},
			apiFetch,
		);
		await prog.ready;
		const outcome = Promise.race([
			prog.read!.read().then(
				() => "resolved",
				() => "rejected",
			),
			new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 500)),
		]);
		prog.close();
		expect(await outcome).toBe("rejected");
	});

	it("pingResponse sends redirect: 'error' and reads a redirect-refused ping as absent", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new TypeError("redirect refused"));

		expect(await pingResponse(API)).toBeNull();
		expect(fetchSpy.mock.calls[0][0]).toBe(API + "/ping");
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({redirect: "error"});
	});

	it("an invalidation throw releases the latch with a warn and a later 401 still routes", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "invalidation-throw@example.test",
			token: "fake-invalidation-throw-token",
			loggedin: true,
		});
		const realTryUpdate = Specialuser.prototype.tryUpdateLocal;
		let invalidations = 0;
		const spy = vi.spyOn(Specialuser.prototype, "tryUpdateLocal").mockImplementation(function (
			this: InstanceType<typeof Specialuser>,
		) {
			if (invalidations++ === 0) throw new DOMException("not found", "NotFoundError");
			return realTryUpdate.call(this);
		});
		let probes = 0;
		captureRequests(API + "/users/@me/delete", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => {
			probes++;
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});

		try {
			await fetchRetryOnce(API + "/users/@me/delete", {
				method: "POST",
				headers: buildAccountHeaders(user),
				body: JSON.stringify({password: "nope"}),
			});
			await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
			expect(nav).not.toHaveBeenCalled();
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(true);

			await fetchRetryOnce(API + "/users/@me/delete", {
				method: "POST",
				headers: buildAccountHeaders(user),
				body: JSON.stringify({password: "nope"}),
			});
			await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
			expect(nav).toHaveBeenCalledWith("/login");
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(false);
			expect(probes).toBe(2);
		} finally {
			spy.mockRestore();
		}
	});

	it("a multi-account invalidation rolls back only the accounts whose save failed", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const addAccount = (email: string) =>
			adduser({
				serverurls: {
					api: API,
					cdn: "http://apifetch.test",
					gateway: "ws://apifetch.test",
					wellknown: "http://apifetch.test",
				},
				email,
				token: "fake-shared-token",
				loggedin: true,
			});
		const savedAccount = addAccount("multi-saved@example.test");
		const rolledBack = addAccount("multi-rollback@example.test");
		const untouched = addAccount("multi-untouched@example.test");
		const realTryUpdate = Specialuser.prototype.tryUpdateLocal;
		let saves = 0;
		const spy = vi.spyOn(Specialuser.prototype, "tryUpdateLocal").mockImplementation(function (
			this: InstanceType<typeof Specialuser>,
		) {
			if (saves++ === 1) throw new DOMException("not found", "NotFoundError");
			return realTryUpdate.call(this);
		});
		captureRequests(API + "/users/@me/delete", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		try {
			await fetchRetryOnce(API + "/users/@me/delete", {
				method: "POST",
				headers: buildAccountHeaders(savedAccount),
				body: JSON.stringify({password: "nope"}),
			});
			await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
			nav.mockClear();
			resetUnauthorizedNavForTests();

			await fetchRetryOnce(API + "/users/@me/delete", {
				method: "POST",
				headers: buildAccountHeaders(rolledBack),
				body: JSON.stringify({password: "nope"}),
			});
			await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
			expect(nav).not.toHaveBeenCalled();
			// The first account saved: memory and storage flipped together.
			expect(savedAccount.loggedin).toBe(false);
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[savedAccount.uid].loggedin).toBe(
				false,
			);
			// The second account's save threw: rolled back in memory, storage never changed —
			// so a later 401 redoes the whole attempt instead of routing over a stale record.
			expect(rolledBack.loggedin).toBe(true);
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[rolledBack.uid].loggedin).toBe(
				true,
			);
			// The third account: never reached — neither flipped nor saved.
			expect(untouched.loggedin).toBe(true);
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[untouched.uid].loggedin).toBe(
				true,
			);
			expect(spy).toHaveBeenCalledTimes(2);
		} finally {
			spy.mockRestore();
		}
	});

	it("two live instances of one account all read logged out after invalidation", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const addTwin = () =>
			new Specialuser({
				serverurls: {
					api: API,
					cdn: "http://apifetch.test",
					gateway: "ws://apifetch.test",
					wellknown: "http://apifetch.test",
				},
				email: "twin@example.test",
				token: "fake-twin-token",
				loggedin: true,
			});
		const boot = addTwin();
		// getBulkUsers builds its twins from the stored record, so the account is stored.
		boot.updateLocal();
		const refreshed = addTwin();
		captureRequests(API + "/users/@me/delete", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/delete", {
			method: "POST",
			headers: buildAccountHeaders(boot),
			body: JSON.stringify({password: "nope"}),
		});
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		// Every live instance of the uid flipped — getBulkUsers constructs a fresh
		// Specialuser per call, so the boot instance and the refreshed one coexist.
		expect(boot.loggedin).toBe(false);
		expect(refreshed.loggedin).toBe(false);
		expect(JSON.parse(localStorage.getItem("userinfos")!).users[boot.uid].loggedin).toBe(false);
	});

	it("a dead old token does not log out the fresh session another tab stored for the same uid (TASK-153)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const serverurls = () => ({
			api: API,
			cdn: "http://apifetch.test",
			gateway: "ws://apifetch.test",
			wellknown: "http://apifetch.test",
		});
		// This tab booted on the old token; another tab then logged in again and stored a new one.
		const stale = adduser({
			serverurls: serverurls(),
			email: "relogin@example.test",
			token: "fake-relogin-old",
			loggedin: true,
		});
		const fresh = adduser({
			serverurls: serverurls(),
			email: "relogin@example.test",
			token: "fake-relogin-new",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(stale),
			body: JSON.stringify({status: "idle"}),
		});
		await vi.waitFor(() => expect(stale.loggedin).toBe(false));

		const stored = JSON.parse(localStorage.getItem("userinfos")!).users[fresh.uid];
		expect(stored.token).toBe("fake-relogin-new");
		expect(stored.loggedin).toBe(true);
		expect(fresh.loggedin).toBe(true);
		// The stale tab still leaves for /login: its own session is dead.
		await vi.waitFor(() => expect(nav).toHaveBeenCalledWith("/login"));
	});

	it("a token READY replaces while the probe is out is not the one invalidated (TASK-153)", async () => {
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "ready-refresh@example.test",
			token: "fake-ready-old",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		let probes = 0;
		captureRequests(API + "/users/@me", () => {
			probes++;
			// READY lands while the probe of the old token is out.
			user.token = "fake-ready-new";
			user.json.token = "fake-ready-new";
			user.tryUpdateLocal();
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({status: "idle"}),
		});
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 50));

		expect(user.loggedin).toBe(true);
		expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(true);
	});

	it("a dead cookie session does not log out a header re-login stored for the same uid (TASK-153)", async () => {
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const serverurls = () => ({
			api: API,
			cdn: "http://apifetch.test",
			gateway: "ws://apifetch.test",
			wellknown: "http://apifetch.test",
		});
		const cookie = adduser({
			serverurls: serverurls(),
			email: "relogin-cookie@example.test",
			auth_mode: "cookie",
			loggedin: true,
		});
		const header = adduser({
			serverurls: serverurls(),
			email: "relogin-cookie@example.test",
			token: "fake-relogin-header",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(cookie),
			body: JSON.stringify({status: "idle"}),
		});
		await vi.waitFor(() => expect(cookie.loggedin).toBe(false));

		const stored = JSON.parse(localStorage.getItem("userinfos")!).users[header.uid];
		expect(stored.token).toBe("fake-relogin-header");
		expect(stored.loggedin).toBe(true);
		expect(header.loggedin).toBe(true);
	});

	it("a dead session another tab already removed is not stored back as a logged-out entry (TASK-155)", async () => {
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "removed-elsewhere@example.test",
			token: "fake-removed-elsewhere",
			loggedin: true,
		});
		// Another tab removes the account while this one still holds it live.
		const info = JSON.parse(localStorage.getItem("userinfos")!);
		delete info.users[user.uid];
		localStorage.setItem("userinfos", JSON.stringify(info));
		captureRequests(API + "/users/@me/settings", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);

		await fetchRetryOnce(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({status: "idle"}),
		});
		// The live instance still flips, so this tab treats the session as dead...
		await vi.waitFor(() => expect(user.loggedin).toBe(false));

		// ...but the store keeps the other tab's removal.
		expect(Object.hasOwn(JSON.parse(localStorage.getItem("userinfos")!).users, user.uid)).toBe(
			false,
		);
	});

	it("the probe uses the FIRST /vN base, not a later /vN segment in the path", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "first-base@example.test",
			token: "fake-first-base-token",
			loggedin: true,
		});
		let wrongBaseProbes = 0;
		let rightBaseProbes = 0;
		captureRequests(API + "/legacy/v2/rooms", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/legacy/v2/users/@me", () => {
			wrongBaseProbes++;
			return Response.json({id: "u-alive"});
		});
		captureRequests(API + "/users/@me", () => {
			rightBaseProbes++;
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});

		await fetchRetryOnce(API + "/legacy/v2/rooms", {
			headers: buildAccountHeaders(user),
		});

		await vi.waitFor(() => expect(wrongBaseProbes + rightBaseProbes).toBe(1));
		expect(wrongBaseProbes).toBe(0);
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
	});

	it("a 401 from a host other than the account's API sends no probe there and logs no one out", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "foreign-401@example.test",
			token: "fake-foreign-401-token",
			loggedin: true,
		});
		const FOREIGN = "http://foreign401.test/api/v9";
		let foreignProbes = 0;
		captureRequests(FOREIGN + "/rooms", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(FOREIGN + "/users/@me", () => {
			foreignProbes++;
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});

		await fetchRetryOnce(FOREIGN + "/rooms", {headers: buildAccountHeaders(user)});
		// Let any probe the 401 path would start reach the interceptor.
		await new Promise((r) => setTimeout(r, 50));

		expect(foreignProbes).toBe(0);
		expect(user.loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();
	});

	it("makeGuild 401 with a dead-token probe invalidates the stored account and routes to /login", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "makeguild-dead@example.test",
			token: "fake-makeguild-dead-token",
			loggedin: true,
		});
		let probes = 0;
		captureRequests(API + "/guilds", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => {
			probes++;
			return Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
		});
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: buildAccountHeaders(user),
		}) as InstanceType<typeof Localuser>;

		expect(await localuser.makeGuild({name: "Server", icon: null})).toBe(false);

		await vi.waitFor(() => {
			expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
		expect(probes).toBe(1);
	});

	it("makeGuild 401 with a 200 probe keeps the account logged in and shows the refusal dialog", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "makeguild-alive@example.test",
			token: "fake-makeguild-alive-token",
			loggedin: true,
		});
		captureRequests(API + "/guilds", () =>
			Response.json({message: "Server creation refused", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () => Response.json({id: "u-alive"}));
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: buildAccountHeaders(user),
		}) as InstanceType<typeof Localuser>;

		expect(await localuser.makeGuild({name: "Server", icon: null})).toBe(false);
		await new Promise((r) => setTimeout(r, 0));

		expect(nav).not.toHaveBeenCalled();
		expect(user.loggedin).toBe(true);
		expect(JSON.parse(localStorage.getItem("userinfos")!).users[user.uid].loggedin).toBe(true);
		expect(document.body.textContent).toContain(I18n.requestFailed("Server creation refused"));
	});

	it("makeGuild POST /guilds sends the name and icon payload untimed", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const sent = captureRequests(API + "/guilds", () =>
			Response.json({id: "g1", name: "My Guild"}),
		);
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {Authorization: "fake-token"},
		}) as InstanceType<typeof Localuser>;

		expect(
			await localuser.makeGuild({
				name: "My Guild",
				icon: "data:image/png;base64,AAAA",
			}),
		).toBe(true);

		expect(sent).toEqual([{name: "My Guild", icon: "data:image/png;base64,AAAA"}]);
		expect(fetchSpy).toHaveBeenCalledWith(
			API + "/guilds",
			expect.objectContaining({
				method: "POST",
				headers: {Authorization: "fake-token"},
				body: JSON.stringify({name: "My Guild", icon: "data:image/png;base64,AAAA"}),
			}),
		);
		expect(fetchSpy.mock.calls[0][1]?.signal).toBeUndefined();
	});

	it("webauthn credentials list GET renders the keys it fetched", async () => {
		captureRequests(API + "/users/@me/connections", () => Response.json([]));
		captureRequests(API + "/connections", () => Response.json({github: {enabled: true}}));
		captureRequests(API + "/teams", () => Response.json([]));
		captureRequests(API + "/applications", () => Response.json([]));
		captureRequests(API + "/policies/instance/", () => Response.json({instanceName: "T"}));
		captureRequests(API + "/auth/sessions", () => Response.json({user_sessions: []}));
		captureRequests(API + "/users/@me/mfa/webauthn/credentials", () =>
			Response.json([
				{id: "k1", name: "YubiKey"},
				{id: "k2", name: "Phone Passkey"},
			]),
		);
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, cdn: "", wellknown: "http://apifetch.test"},
			headers: {Authorization: "fake-token"},
			user: {
				id: "me",
				pronouns: "",
				bio: {rawString: ""},
				getpfpsrc: () => "",
				clone: () => ({
					pronouns: "",
					bio: "",
					buildprofile: async () => document.createElement("div"),
				}),
			},
			rights: {allow: 0, hasPermission: () => false},
			inrelation: new Set(),
			channelids: new Map(),
			userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
			userMap: new Map(),
			guilds: [],
			trace: [],
		}) as unknown as InstanceType<typeof Localuser>;

		await localuser.showusersettings();
		[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
			.find((b) => b.textContent === I18n.localuser.accountSettings())!
			.click();
		[...document.querySelectorAll<HTMLButtonElement>("button")]
			.find((b) => b.textContent === I18n.webauth.manage())!
			.click();

		await vi.waitFor(() => {
			const labels = [...document.querySelectorAll<HTMLButtonElement>("button")].map(
				(b) => b.textContent,
			);
			expect(labels).toContain("YubiKey");
			expect(labels).toContain("Phone Passkey");
		});
	});
});

describe("refusal unification (C14)", () => {
	it("changeRelationship surfaces the server reason string", async () => {
		captureRequests(API + "/users/@me/relationships/u2", () =>
			Response.json({code: 50013, message: "Relationship change refused"}, {status: 403}),
		);
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API},
			headers: {Authorization: "fake-token"},
			relChangeUpdateMap: new Map(),
		}) as InstanceType<typeof Localuser>;
		const user = Object.assign(Object.create(User.prototype), {
			id: "u2",
			owner: localuser,
		}) as InstanceType<typeof User>;

		await user.changeRelationship(1);

		expect(document.body.textContent).toContain(I18n.requestFailed("Relationship change refused"));
	});

	it("updateRolePermissions surfaces the server reason string", async () => {
		captureRequests(API + "/channels/c1/permissions/r1", () =>
			Response.json({code: 50013, message: "Channel overwrite refused"}, {status: 403}),
		);
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			headers: {Authorization: "fake-token"},
			permission_overwrites: new Map([["r1", new Permissions("1", "2")]]),
			overwriteTypes: new Map([["r1", 0]]),
			owner: {info: {api: API}},
		}) as InstanceType<typeof Channel>;

		await channel.updateRolePermissions("r1", new Permissions("8", "4"));

		expect(document.body.textContent).toContain(I18n.requestFailed("Channel overwrite refused"));
	});

	it("Guild.updateRolePermissions surfaces the server reason string", async () => {
		captureRequests(API + "/guilds/g1/roles/r1", () =>
			Response.json({code: 50013, message: "Guild role permission refused"}, {status: 403}),
		);
		const guild = Object.assign(Object.create(Guild.prototype), {
			id: "g1",
			headers: {Authorization: "fake-token"},
			roleids: new Map([["r1", {id: "r1", permissions: new Permissions("1", "2")}]]),
			owner: {info: {api: API}},
		}) as InstanceType<typeof Guild>;

		expect(await guild.updateRolePermissions("r1", new Permissions("8", "4"))).toBe(false);

		expect(document.body.textContent).toContain(
			I18n.requestFailed("Guild role permission refused"),
		);
	});

	it("User.opendm surfaces the server reason string", async () => {
		captureRequests(API + "/users/@me/channels", () =>
			Response.json({code: 50007, message: "Cannot send messages to this user"}, {status: 403}),
		);
		const user = Object.assign(Object.create(User.prototype), {
			id: "u2",
			owner: {
				info: {api: API},
				headers: {Authorization: "fake-token"},
				guildids: new Map([["@me", {channels: []}]]),
			},
		}) as InstanceType<typeof User>;

		await user.opendm();

		expect(document.body.textContent).toContain(
			I18n.requestFailed("Cannot send messages to this user"),
		);
	});

	it("opendm's ok-but-unusable leg still renders the server's message", async () => {
		captureRequests(API + "/users/@me/channels", () =>
			Response.json({message: "channel cap reached"}, {status: 200}),
		);
		const user = Object.assign(Object.create(User.prototype), {
			id: "u2",
			owner: {
				info: {api: API},
				headers: {Authorization: "fake-token"},
				guildids: new Map([["@me", {channels: []}]]),
			},
		}) as InstanceType<typeof User>;

		await user.opendm();

		// A 200 with no usable id still reads as a refusal — and the body survives the
		// ok-leg parse (the clone) so the server's message renders, not "HTTP 200".
		expect(document.body.textContent).toContain(I18n.requestFailed("channel cap reached"));
	});

	it("Direct.makeGroup surfaces the server reason string", async () => {
		captureRequests(API + "/users/@me/channels", () =>
			Response.json({code: 50013, message: "Group DM creation refused"}, {status: 403}),
		);
		vi.spyOn(User, "makeSelector").mockResolvedValue(
			new Set([{id: "u2"} as InstanceType<typeof User>]),
		);
		const direct = Object.assign(Object.create(Direct.prototype), {
			headers: {Authorization: "fake-token"},
			owner: {
				info: {api: API},
				inrelation: new Set(),
			},
		}) as InstanceType<typeof Direct>;

		await direct.makeGroup();

		expect(document.body.textContent).toContain(I18n.requestFailed("Group DM creation refused"));
	});

	it("makeGroup's ok-but-unusable leg still renders the server's message", async () => {
		captureRequests(API + "/users/@me/channels", () =>
			Response.json({message: "invite cap reached"}, {status: 200}),
		);
		vi.spyOn(User, "makeSelector").mockResolvedValue(
			new Set([{id: "u2"} as InstanceType<typeof User>]),
		);
		const direct = Object.assign(Object.create(Direct.prototype), {
			headers: {Authorization: "fake-token"},
			owner: {
				info: {api: API},
				inrelation: new Set(),
			},
		}) as InstanceType<typeof Direct>;

		await direct.makeGroup();

		expect(document.body.textContent).toContain(I18n.requestFailed("invite cap reached"));
	});

	it("makeMenu surfaces the server reason string", async () => {
		for (const id of [
			"channelTopic",
			"loadingdiv",
			"scrollWrap",
			"channels",
			"servertd",
			"serverName",
		]) {
			const el = document.createElement("div");
			el.id = id;
			document.body.append(el);
		}
		let calls = 0;
		captureRequests(API + "/discoverable-guilds", () =>
			calls++ === 0
				? Response.json(
						{
							code: 50035,
							message: "Invalid Form Body",
							errors: {offset: {_errors: [{message: "Discovery offset refused"}]}},
						},
						{status: 400},
					)
				: Response.json({message: "Discovery disabled on instance"}, {status: 403}),
		);
		const discovery = Object.assign(Object.create(Discovery.prototype), {
			owner: {
				info: {api: API, cdn: "http://apifetch.test"},
				headers: {Authorization: "fake-token"},
				localuser: {guildids: new Map(), pageTitle: () => {}, getSidePannel: () => {}},
			},
			context: {bindContextmenu: () => {}},
		}) as InstanceType<typeof Discovery>;

		await discovery.makeMenu();
		const scrollWrap = document.getElementById("scrollWrap")!;
		await expect
			.poll(() => scrollWrap.textContent)
			.toContain(I18n.requestFailed("Discovery offset refused"));

		[...scrollWrap.querySelectorAll("button")]
			.find((b) => b.textContent === I18n.tryAgain())!
			.click();
		await expect
			.poll(() => scrollWrap.textContent)
			.toContain(I18n.requestFailed("Discovery disabled on instance"));
	});

	it("showNewInvite surfaces the server reason string", async () => {
		let calls = 0;
		captureRequests(API + "/channels/c1/invites", () =>
			calls++ === 0
				? Response.json(
						{
							code: 50035,
							message: "Invalid Form Body",
							errors: {max_age: {_errors: [{message: "Invite duration refused"}]}},
						},
						{status: 400},
					)
				: Response.json({message: "Invites disabled for channel"}, {status: 403}),
		);
		const inviteSpan = document.createElement("span");

		await showNewInvite(
			API + "/channels/c1/invites",
			{Authorization: "fake-token"},
			{max_age: 999, max_uses: 1},
			"http://apifetch.test",
			inviteSpan,
		);
		expect(inviteSpan.textContent).toContain("Invite duration refused");

		await showNewInvite(
			API + "/channels/c1/invites",
			{Authorization: "fake-token"},
			{max_age: 0, max_uses: 1},
			"http://apifetch.test",
			inviteSpan,
		);
		expect(inviteSpan.textContent).toContain("Invites disabled for channel");
	});

	it("ReportMenu.send surfaces the server reason string", async () => {
		const postback = API + "/reporting/guild";
		captureRequests(postback, () =>
			Response.json({code: 40001, message: "Report submission refused"}, {status: 403}),
		);
		const reportMenu = new ReportMenu(
			{
				version: "1.0",
				name: "guild",
				variant: "1",
				postback_url: postback,
				root_node_id: 1,
				success_node_id: 2,
				fail_node_id: 3,
				nodes: {
					1: {
						id: 1,
						key: "root",
						header: "Root",
						subheader: null,
						info: null,
						button: {type: "submit", target: null},
						elements: [],
						report_type: null,
						children: [],
						is_multi_select_required: false,
						is_auto_submit: false,
					},
					2: {
						id: 2,
						key: "ok",
						header: "Done",
						subheader: null,
						info: null,
						button: null,
						elements: [],
						report_type: null,
						children: [],
						is_multi_select_required: false,
						is_auto_submit: false,
					},
					3: {
						id: 3,
						key: "fail",
						header: "Failed",
						subheader: null,
						info: null,
						button: null,
						elements: [
							{
								name: "fail",
								type: "fail",
								data: null,
								should_submit_data: false,
								skip_if_unlocalized: false,
								is_localized: true,
							},
						],
						report_type: null,
						children: [],
						is_multi_select_required: false,
						is_auto_submit: false,
					},
				},
			} as never,
			{info: {api: API}, headers: {Authorization: "fake-token"}} as never,
			{guild: {id: "g1"}} as never,
		);

		await reportMenu.spawnMenu();
		await reportMenu.submit();

		expect(document.querySelector(".reportMenu")?.textContent).toContain(
			I18n.requestFailed("Report submission refused"),
		);
	});

	it("Command.submit / sendErrorText surface the server reason string", async () => {
		let calls = 0;
		captureRequests(API + "/interactions", () =>
			calls++ === 0
				? Response.json(
						{
							code: 50035,
							message: "Invalid Form Body",
							errors: {options: {_errors: [{message: "Command option refused"}]}},
						},
						{status: 400},
					)
				: Response.json({message: "Command is disabled here"}, {status: 403}),
		);
		const command = new Command(
			{
				id: "cmd1",
				type: 1,
				application_id: "app1",
				name: "testcmd",
				description: "",
				dm_permission: true,
				version: "1",
				options: [],
			} as never,
			{
				info: {api: API},
				headers: {Authorization: "fake-token"},
				owner: {registerCommandNonce: () => {}, forgetCommandNonce: () => {}},
			} as never,
		);
		const dmChannel = {id: "c1", owner: {id: "@me"}} as never;
		command.state.set(dmChannel, []);
		const cmdBox = document.createElement("div");
		const cmdHtml = cmdBox.appendChild(document.createElement("div"));

		expect(await command.submit(cmdHtml, dmChannel)).toBe(false);
		expect(cmdBox.querySelector(".commandError")?.textContent).toContain("Command option refused");

		cmdBox.querySelector(".commandError")?.remove();
		expect(await command.submit(cmdHtml, dmChannel)).toBe(false);
		expect(cmdBox.querySelector(".commandError")?.textContent).toContain(
			"Command is disabled here",
		);

		// channel.ts:76 (sendErrorText on refused message send)
		const realbox = document.createElement("div");
		realbox.id = "realbox";
		document.body.append(realbox);
		vi.stubGlobal(
			"XMLHttpRequest",
			class {
				status = 0;
				response: unknown = null;
				responseType = "";
				timeout = 0;
				upload = {onprogress: null};
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				ontimeout: (() => void) | null = null;
				open() {}
				setRequestHeader() {}
				send() {
					this.status = 403;
					this.response = {code: 50013, message: "Send message refused"};
					queueMicrotask(() => this.onload?.());
				}
			},
		);
		const sendChannel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}},
			headers: {"Content-type": "application/json", Authorization: "fake-token"},
			makeFakeMessage: vi.fn(async () => ({progress: vi.fn(), failed: vi.fn(), void: vi.fn()})),
			slowmode: vi.fn(),
		}) as InstanceType<typeof Channel>;
		Object.defineProperty(sendChannel, "localuser", {value: {channelfocus: sendChannel}});

		await sendChannel.sendMessage("hello", {nonce: "n-c14"}, () => true);

		expect(realbox.querySelector(".sendError")?.textContent).toBe("Send message refused");
		// Hand the real XHR back: the stub must not leak into the tests after this one.
		vi.stubGlobal("XMLHttpRequest", realXHR);
	});

	it("sendForward surfaces the server reason string for a refused forward (R1)", async () => {
		const {message} = messageIn("guild-1");
		captureRequests(FIXTURE_API + "/channels/t1/messages", () =>
			Response.json({code: 50013, message: "Forward refused"}, {status: 403}),
		);

		await sendForward(message, {id: "t1"});

		expect(document.body.textContent).toContain(I18n.requestFailed("Forward refused"));
	});
});

describe("U-api 2d: channel, member and message wiring", () => {
	const userinfoOf = (uid: string) => JSON.parse(localStorage.getItem("userinfos")!).users[uid];

	it("channel putmessages 401 with a dead-token probe invalidates the account and routes to /login (R2)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "putmessages-dead@example.test",
			token: "fake-putmessages-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/channels/c1/messages", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}},
			headers: buildAccountHeaders(user),
		}) as InstanceType<typeof Channel>;

		await channel.putmessages();

		await vi.waitFor(() => {
			expect(userinfoOf(user.uid).loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("member kickAPI 401 with a dead-token probe invalidates the account and routes to /login (R3)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "kick-dead@example.test",
			token: "fake-kick-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/guilds/g1/members/u1", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		const member = Object.assign(Object.create(Member.prototype), {
			id: "u1",
			owner: {id: "g1", info: {api: API}, headers: buildAccountHeaders(user)},
		}) as unknown as {kickAPI: (reason: string) => Promise<boolean>};

		expect(await member.kickAPI("")).toBe(false);

		await vi.waitFor(() => {
			expect(userinfoOf(user.uid).loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("member kickAPI 401 with a 200 probe keeps the account logged in and shows the refusal (P1)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "kick-alive@example.test",
			token: "fake-kick-alive-token",
			loggedin: true,
		});
		captureRequests(API + "/guilds/g1/members/u1", () =>
			Response.json({message: "Kick refused", code: 0}, {status: 401}),
		);
		let probes = 0;
		captureRequests(API + "/users/@me", () => {
			probes++;
			return Response.json({id: "u-alive"});
		});
		const member = Object.assign(Object.create(Member.prototype), {
			id: "u1",
			owner: {id: "g1", info: {api: API}, headers: buildAccountHeaders(user)},
		}) as unknown as {kickAPI: (reason: string) => Promise<boolean>};

		expect(await member.kickAPI("")).toBe(false);
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));

		expect(nav).not.toHaveBeenCalled();
		expect(userinfoOf(user.uid).loggedin).toBe(true);
		expect(document.body.textContent).toContain(I18n.requestFailed("Kick refused"));
	});

	it("message delete 401 with a dead-token probe invalidates the account and routes to /login (R4)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls: {
				api: API,
				cdn: "http://apifetch.test",
				gateway: "ws://apifetch.test",
				wellknown: "http://apifetch.test",
			},
			email: "delete-dead@example.test",
			token: "fake-delete-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/channels/c1/messages/m1", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		captureRequests(API + "/users/@me", () =>
			Response.json({message: "401: Unauthorized", code: 0}, {status: 401}),
		);
		const headers = buildAccountHeaders(user);
		const message = Object.assign(Object.create(Message.prototype), {
			id: "m1",
			owner: {id: "c1", info: {api: API}, headers},
			headers,
		}) as InstanceType<typeof Message>;

		await message.delete();

		await vi.waitFor(() => {
			expect(userinfoOf(user.uid).loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("channel history page 429 retry sends both requests with redirect: 'error' (R5)", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({retry_after: 0}, {status: 429}))
			.mockResolvedValueOnce(Response.json([], {status: 200}));
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			owner: {info: {api: API}},
			headers: {Authorization: "fake-history-token"},
		}) as InstanceType<typeof Channel>;

		const page = await (
			channel as unknown as {fetchHistoryPage: (query: string) => Promise<unknown>}
		).fetchHistoryPage("before=1");

		expect(page).toEqual([]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({redirect: "error"});
		expect(fetchSpy.mock.calls[1][1]).toMatchObject({redirect: "error"});
	});

	it("the reaction hover preview (retry: false) sends redirect: 'error' like the popup's retry path", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json([]));
		const message = Object.assign(Object.create(Message.prototype), {
			id: "m1",
			owner: {id: "c1", info: {api: API}},
			headers: {Authorization: "fake-reaction-token"},
		}) as InstanceType<typeof Message>;

		expect(await fetchReactionUsers(message, {name: "🔥"}, 3, {retry: false})).toEqual([]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({redirect: "error"});
	});
});

// U-api 2e (TASK-4): the tail moves onto apiFetch. RED rows fail at base; PIN rows pin behaviour
// that must hold both before and after the swap.
describe("U-api 2e: the tail on apiFetch", () => {
	const userinfoOf = (uid: string) => JSON.parse(localStorage.getItem("userinfos")!).users[uid];
	const unauthorized = () => Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
	const serverurls = {
		api: API,
		cdn: "http://apifetch.test",
		gateway: "ws://apifetch.test",
		wellknown: "http://apifetch.test",
	};

	it("RED A: /auth/logout is pre-auth (its 401 means the token is already dead); /auth/sessions/logout is not", () => {
		expect(isPreAuthEndpoint(API + "/auth/logout")).toBe(true);
		expect(isPreAuthEndpoint(API + "/auth/sessions/logout")).toBe(false);
	});

	it("RED B: instance discovery answers within the API budget when its well-known never settles", async () => {
		vi.useFakeTimers();
		try {
			// A hung GET rejects only when its caller's signal aborts (the pingGuard idiom), so
			// a pre-fix call simply never settles.
			vi.spyOn(globalThis, "fetch").mockImplementation(
				(_url: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_, rej) => {
						init?.signal?.addEventListener("abort", () =>
							rej(new DOMException("aborted", "AbortError")),
						);
					}),
			);
			let outcome: {verdict: string; urls?: unknown} = {verdict: "unsettled"};
			void getApiUrlsV2("https://discovery-hang.test").then(
				(urls) => (outcome = {verdict: "settled", urls}),
				() => (outcome = {verdict: "error"}),
			);
			await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5_000);
			expect(outcome.verdict).toBe("settled");
			expect(outcome.urls).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("RED C: a notes save 401 with a dead token probes it and routes to /login", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls,
			email: "notes-dead@example.test",
			token: "fake-notes-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/notes/u2", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);
		// User's info and headers are prototype getters, so Object.assign would throw: define own props.
		const other = Object.create(User.prototype, {
			id: {value: "u2"},
			info: {value: {api: API}},
			headers: {value: buildAccountHeaders(user)},
		}) as InstanceType<typeof User>;

		await other.saveNotes("hello");

		await vi.waitFor(() => {
			expect(userinfoOf(user.uid).loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("RED D: the bot-authorize 401 with a dead token probes it and routes to /login (standalone page)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = adduser({
			serverurls,
			email: "bot-dead@example.test",
			token: "fake-bot-dead-token",
			loggedin: true,
		});
		captureRequests(API + "/oauth2/authorize", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);

		await authorizeBot(API, user, "bot1", "g1", null);

		await vi.waitFor(() => {
			expect(userinfoOf(user.uid).loggedin).toBe(false);
			expect(nav).toHaveBeenCalledTimes(1);
		});
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("PIN: a logout 401 with a dead token sends no probe and routes nowhere (the logout flow owns it)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const user = adduser({
			serverurls,
			email: "logout-dead@example.test",
			token: "fake-logout-dead-token",
			loggedin: true,
		});
		let logoutCalls = 0;
		let probes = 0;
		captureRequests(API + "/auth/logout", () => {
			logoutCalls++;
			return unauthorized();
		});
		captureRequests(API + "/users/@me", () => {
			probes++;
			return unauthorized();
		});

		expect(await user.logout()).toBe(true);
		await new Promise((r) => setTimeout(r, 0));

		// One call: a logout 401 means the session is already gone, so it isn't retried (TASK-149).
		expect(logoutCalls).toBe(1);
		expect(probes).toBe(0);
		expect(nav).not.toHaveBeenCalled();
		const logoutInit = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/auth/logout"))?.[1];
		expect(accountUidOf(logoutInit)).toBe(user.uid);
		expect(logoutInit?.headers).toEqual({Authorization: "fake-logout-dead-token"});
	});

	it("PIN: instance discovery's well-known GET is not redirect-refused (a trailing-slash redirect is followed)", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({}));

		expect(await getApiUrlsV2("https://discovery-pin.test")).toBeNull();

		expect(fetchSpy.mock.calls[0][1]?.redirect).not.toBe("error");
	});

	it("PIN: saveProfile sends redirect: 'error' and no timeout signal (an image body is not cut at 30 s)", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, {status: 204}));

		expect(await saveProfile(API + "/users/@me", {Authorization: "fake-save-token"}, {})).toBe(
			true,
		);

		const init = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(init.redirect).toBe("error");
		expect(init.signal).toBeUndefined();
	});

	it("PIN: exportUserData sends redirect: 'error' and no timeout signal", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response("boom", {status: 500}));

		expect(await exportUserData(API, {Authorization: "fake-export-token"}, "u1")).toEqual(
			expect.any(String),
		);

		const init = fetchSpy.mock.calls[0][1] as RequestInit;
		expect(init.redirect).toBe("error");
		expect(init.signal).toBeUndefined();
	});
});

describe("401 handling keyed by account uid (TASK-148)", () => {
	const userinfoOf = (uid: string) => JSON.parse(localStorage.getItem("userinfos")!).users[uid];
	const unauthorized = () => Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
	const serverurls = {
		api: API,
		cdn: "http://apifetch.test",
		gateway: "ws://apifetch.test",
		wellknown: "http://apifetch.test",
	};

	it("invalidates only account A when A's tagged request 401s and probe 401s (B on the same host stays logged in)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const a = adduser({
			serverurls,
			email: "uid-a@example.test",
			token: "fake-token-a",
			loggedin: true,
		});
		const b = adduser({
			serverurls,
			email: "uid-b@example.test",
			token: "fake-token-b",
			loggedin: true,
		});
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);

		await apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(a),
			body: JSON.stringify({status: "idle"}),
		});

		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(a.loggedin).toBe(false);
		expect(userinfoOf(a.uid).loggedin).toBe(false);
		expect(b.loggedin).toBe(true);
		expect(userinfoOf(b.uid).loggedin).toBe(true);
	});

	it("returns false from handleUnauthorized for an untagged request carrying an Authorization header", () => {
		adduser({
			serverurls,
			email: "untagged@example.test",
			token: "fake-untagged-token",
			loggedin: true,
		});
		expect(
			handleUnauthorized(API + "/users/@me/settings", {
				headers: {Authorization: "fake-untagged-token"},
			}),
		).toBe(false);
	});

	it("probes with the account's new token after READY replaced an old one, keeping the account logged in", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const a = adduser({
			serverurls,
			email: "stale-ready@example.test",
			token: "old",
			loggedin: true,
		});
		const staleRequestHeaders = buildAccountHeaders(a);
		// READY refreshes the account's token in memory before the stale request's 401 lands.
		const liveHeaders = buildAccountHeaders(a);
		a.token = "new";
		a.json.token = "new";
		applyAccountHeaders(liveHeaders, a);

		let probeAuth: string | undefined;
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", () => {
			const probeCall = fetchSpy.mock.calls.find(([u]) => String(u) === API + "/users/@me");
			probeAuth = (probeCall?.[1]?.headers as {Authorization?: string} | undefined)?.Authorization;
			return probeAuth === "new" ? Response.json({id: "u-alive"}) : unauthorized();
		});

		await apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers: staleRequestHeaders,
			body: JSON.stringify({status: "idle"}),
		});

		await vi.waitFor(() => expect(probeAuth).toBe("new"));
		await new Promise((r) => setTimeout(r, 0));
		expect(a.loggedin).toBe(true);
		expect(userinfoOf(a.uid).loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();
	});

	it("probes with the instance that built the headers, not a later copy of the same uid holding an older token", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const a = adduser({
			serverurls,
			email: "dup-instance@example.test",
			token: "fresh",
			loggedin: true,
		});
		const headers = buildAccountHeaders(a);
		// An embed's getBulkUsers builds another live instance of the same uid, still on an old token.
		const copy = new Specialuser({...structuredClone(a.json), token: "stale"});
		expect(copy.uid).toBe(a.uid);

		let probeAuth: string | undefined;
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", () => {
			const probeCall = fetchSpy.mock.calls.find(([u]) => String(u) === API + "/users/@me");
			probeAuth = (probeCall?.[1]?.headers as {Authorization?: string} | undefined)?.Authorization;
			return probeAuth === "fresh" ? Response.json({id: "u-alive"}) : unauthorized();
		});

		await apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers,
			body: JSON.stringify({status: "idle"}),
		});

		await vi.waitFor(() => expect(probeAuth).toBeDefined());
		await new Promise((r) => setTimeout(r, 0));
		expect(probeAuth).toBe("fresh");
		expect(a.loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();
	});

	it("a cookie account whose invalidation save throws keeps its auth_mode and stays logged in", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cookieUser = adduser({
			serverurls,
			email: "cookie-rollback@example.test",
			auth_mode: "cookie",
			loggedin: true,
		});
		const spy = vi.spyOn(Specialuser.prototype, "tryUpdateLocal").mockImplementation(() => {
			throw new DOMException("not found", "NotFoundError");
		});
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", unauthorized);

		try {
			await apiFetch(API + "/users/@me/settings", {
				method: "PATCH",
				headers: buildAccountHeaders(cookieUser),
				body: JSON.stringify({status: "idle"}),
			});
			await vi.waitFor(() => expect(warn).toHaveBeenCalled());
			expect(nav).not.toHaveBeenCalled();
			expect(cookieUser.loggedin).toBe(true);
			expect(cookieUser.authMode).toBe("cookie");
			expect(cookieUser.json.auth_mode).toBe("cookie");
		} finally {
			spy.mockRestore();
		}
	});

	it("probes a cookie account with the CSRF marker and no Authorization, and clears json.auth_mode when dead", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const cookieUser = adduser({
			serverurls,
			email: "cookie-dead@example.test",
			auth_mode: "cookie",
			loggedin: true,
		});
		expect(cookieUser.authMode).toBe("cookie");

		let probeHeaders: Record<string, unknown> | undefined;
		captureRequests(API + "/users/@me/settings", unauthorized);
		captureRequests(API + "/users/@me", () => {
			const probeCall = fetchSpy.mock.calls.find(([u]) => String(u) === API + "/users/@me");
			probeHeaders = probeCall?.[1]?.headers as Record<string, unknown> | undefined;
			return unauthorized();
		});

		await apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(cookieUser),
			body: JSON.stringify({status: "idle"}),
		});

		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(probeHeaders).toBeDefined();
		expect(probeHeaders?.[CSRF_HEADER]).toBe("1");
		expect("Authorization" in (probeHeaders ?? {})).toBe(false);
		expect(cookieUser.loggedin).toBe(false);
		expect(cookieUser.authMode).toBeUndefined();
		expect("auth_mode" in cookieUser.json).toBe(false);
		expect(userinfoOf(cookieUser.uid).loggedin).toBe(false);
		expect("auth_mode" in userinfoOf(cookieUser.uid)).toBe(false);
	});
});

describe("401 handling across an account switch (TASK-156)", () => {
	const unauthorized = () => Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
	const serverurls = {
		api: API,
		cdn: "http://apifetch.test",
		gateway: "ws://apifetch.test",
		wellknown: "http://apifetch.test",
	};
	const twoAccounts = () => ({
		a: adduser({
			serverurls,
			email: "switch-a@example.test",
			token: "fake-switch-a",
			loggedin: true,
		}),
		b: adduser({
			serverurls,
			email: "switch-b@example.test",
			token: "fake-switch-b",
			loggedin: true,
		}),
	});
	/** The probe answers in call order; each answer settles only when the test resolves it. */
	function heldProbes() {
		const answers: ((res: Response) => void)[] = [];
		captureRequests(
			API + "/users/@me",
			() => new Promise<Response>((resolve) => answers.push(resolve)),
		);
		return answers;
	}
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	// The Localuser constructor writes the search box's hint (updateTranslations), and registers
	// a service-worker listener that holds the instance: the tests that construct one drop the
	// listeners it added.
	let swRefreshBefore: Set<unknown>;
	beforeEach(() => {
		const searchBox = document.createElement("div");
		searchBox.id = "searchBox";
		document.body.append(searchBox);
		swRefreshBefore = new Set(SW.eventListeners.get("refreshURL"));
	});
	afterEach(() => {
		document.getElementById("searchBox")?.remove();
		const listeners = SW.eventListeners.get("refreshURL");
		for (const listener of listeners ?? []) {
			if (!swRefreshBefore.has(listener)) listeners?.delete(listener);
		}
	});
	const patchSettings = (account: InstanceType<typeof Specialuser>) =>
		apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(account),
			body: JSON.stringify({status: "idle"}),
		});

	it("the switched-to account's dead session routes to /login while the old account's probe is still out", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const {a, b} = twoAccounts();
		captureRequests(API + "/users/@me/settings", unauthorized);
		const answers = heldProbes();

		await patchSettings(a); // A's probe goes out and stays out.
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		noteActiveAccount(b.uid); // The tab switches to B (showAccountSwitcher, no reload).
		await patchSettings(b); // B's session is dead: its own probe must go out.

		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1](unauthorized());
		await vi.waitFor(() => expect(b.loggedin).toBe(false));
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");

		answers[0](Response.json({id: "a"})); // A was alive all along.
		await settle();
		expect(a.loggedin).toBe(true);
		expect(nav).toHaveBeenCalledTimes(1);
	});

	it("a probe that outlives the switch logs the old account out without routing the new one to /login", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const {a, b} = twoAccounts();
		captureRequests(API + "/users/@me/settings", unauthorized);
		const answers = heldProbes();

		await patchSettings(a);
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		noteActiveAccount(b.uid);
		answers[0](unauthorized()); // A's session was dead.

		await vi.waitFor(() => expect(a.loggedin).toBe(false));
		await settle();
		expect(nav).not.toHaveBeenCalled();
		expect(b.loggedin).toBe(true);

		// A's verdict left nothing held: B's own later death still routes.
		await patchSettings(b);
		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1](unauthorized());
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(b.loggedin).toBe(false);
	});

	it("the switched-to account's gateway 4004 routes to /login while the old account's probe is still out (TASK-170)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const {a, b} = twoAccounts();
		captureRequests(API + "/users/@me/settings", unauthorized);
		const answers = heldProbes();
		// B's Localuser as the switch leaves it, built without the constructor's side effects.
		const l = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
		l.userinfo = b;
		l.info = b.serverurls;
		l.headers = buildAccountHeaders(b);
		l.identifiedToken = b.token;
		l.gatewayAuthAttempt = 0;
		l.gatewayAuthRetried = false;
		const reconnect = vi.spyOn(l, "initwebsocket").mockResolvedValue();

		await patchSettings(a); // A's probe goes out and stays out.
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		noteActiveAccount(b.uid);
		l.gatewayAuthFailed(); // B's socket closes 4004: its own probe must go out.

		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1](unauthorized());
		await vi.waitFor(() => expect(b.loggedin).toBe(false));
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(reconnect).not.toHaveBeenCalled();

		answers[0](Response.json({id: "a"})); // A was alive all along.
		await settle();
		expect(a.loggedin).toBe(true);
		expect(nav).toHaveBeenCalledTimes(1);
	});

	it("constructing a Localuser registers its account as the page's active one", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const {a, b} = twoAccounts();
		captureRequests(API + "/users/@me/settings", unauthorized);
		const answers = heldProbes();
		noteActiveAccount(a.uid);

		await patchSettings(a);
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		new Localuser(b);
		answers[0](unauthorized());

		await vi.waitFor(() => expect(a.loggedin).toBe(false));
		await settle();
		expect(nav).not.toHaveBeenCalled(); // B runs the page now: A's death routes nowhere.
	});

	it("a Localuser whose construction throws does not register its account (index.ts falls back to none) (TASK-170)", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const {a, b} = twoAccounts();
		captureRequests(API + "/users/@me/settings", unauthorized);
		const answers = heldProbes();
		document.getElementById("searchBox")?.remove(); // updateTranslations throws without it.

		expect(() => new Localuser(b)).toThrow(TypeError);
		// The boot page runs no account: any account's confirmed death routes to /login.
		await patchSettings(a);
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		answers[0](unauthorized());

		await vi.waitFor(() => expect(a.loggedin).toBe(false));
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
	});
});

describe("401 latch keyed by credential (TASK-169)", () => {
	const unauthorized = () => Response.json({message: "401: Unauthorized", code: 0}, {status: 401});
	const serverurls = {
		api: API,
		cdn: "http://apifetch.test",
		gateway: "ws://apifetch.test",
		wellknown: "http://apifetch.test",
	};
	const account = (token: string) =>
		adduser({serverurls, email: "rotate@example.test", token, loggedin: true});
	/** The probes answer in call order; each settles only when the test resolves it. */
	function heldProbes() {
		const answers: ((res: Response) => void)[] = [];
		const requests = recordRequests(
			API + "/users/@me",
			() => new Promise<Response>((resolve) => answers.push(resolve)),
		);
		return {answers, requests};
	}
	/** What READY's auth_token does to a header account (Localuser.adoptReadyToken). */
	const readyRotates = (user: InstanceType<typeof Specialuser>, token: string) => {
		user.token = token;
		user.json.token = token;
		user.tryUpdateLocal();
	};
	const patchSettings = (user: InstanceType<typeof Specialuser>) =>
		apiFetch(API + "/users/@me/settings", {
			method: "PATCH",
			headers: buildAccountHeaders(user),
			body: JSON.stringify({status: "idle"}),
		});
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("a token READY swapped in while the old token's probe is out gets its own probe when it 401s", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = account("fake-rotate-old");
		captureRequests(API + "/users/@me/settings", unauthorized);
		const {answers, requests} = heldProbes();

		await patchSettings(user);
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		readyRotates(user, "fake-rotate-new");
		await patchSettings(user); // The new token is dead too: it must be probed, not wait.

		await vi.waitFor(() => expect(answers).toHaveLength(2));
		expect(requests.map((r) => r.headers.get("Authorization"))).toEqual([
			"fake-rotate-old",
			"fake-rotate-new",
		]);
		answers[0](unauthorized()); // The old token is dead, but the record holds the new one.
		await settle();
		expect(user.loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();

		answers[1](unauthorized());
		await vi.waitFor(() => expect(user.loggedin).toBe(false));
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
	});

	it("a held run hands its verdict to the same credential only (the gateway's 4004 path)", async () => {
		vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = account("fake-held-old");
		const {answers} = heldProbes();
		const probe = () => probeUnauthorized(API + "/users/@me", {headers: buildAccountHeaders(user)});

		const first = probe();
		expect(probe()).toBe(first);
		readyRotates(user, "fake-held-new");
		const second = probe();
		expect(second).not.toBe(first);

		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[0](unauthorized());
		answers[1](Response.json({id: "rotate"}));
		expect(await first).toBe("notDead"); // Dead, but no record holds it any more.
		expect(await second).toBe("notDead");
		expect(user.loggedin).toBe(true);
	});

	it("two dead credentials of one account route to /login once", async () => {
		const nav = vi.spyOn(pageNav, "go").mockImplementation(() => {});
		const user = account("fake-twice-old");
		const {answers} = heldProbes();
		const probe = () => probeUnauthorized(API + "/users/@me", {headers: buildAccountHeaders(user)});

		const first = probe();
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		answers[0](unauthorized());
		expect(await first).toBe("dead");
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));

		// A token swapped in before the page leaves dies too.
		readyRotates(user, "fake-twice-new");
		const second = probe();
		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1](unauthorized());
		expect(await second).toBe("dead");
		await settle();
		expect(nav).toHaveBeenCalledTimes(1);
	});
});
