import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Channel} = await import("./channel");
const {User} = await import("./user");
const {Discovery} = await import("./discovery");
const {ReportMenu} = await import("./reporting/report");
const {Command} = await import("./interactions/commands");
const {Permissions} = await import("./permissions");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
const {pageNav, acceptInvite} = await import("./invite");
const {fetchRetryOnce} = await import("./utils/rateLimit");
const {apiFetch, configureApiXhr, isPreAuthEndpoint, resetUnauthorizedNavForTests} =
	await import("./utils/apiFetch");
const {showNewInvite} = await import("./utils/inviteLink");
const {adduser, Specialuser} = await import("./utils/utils");
const {readItem, resetSettingOverlayForTests} = await import("./utils/storage/settingOverlay");
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

		await Promise.all([
			fetchRetryOnce(API + "/users/@me/settings", {
				method: "PATCH",
				headers: {Authorization: user.token},
				body: JSON.stringify({status: "idle"}),
			}),
			acceptInvite(API, "abc", user.token),
			showNewInvite(
				API + "/channels/c1/invites",
				{Authorization: user.token},
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
			headers: {Authorization: user.token},
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

		await acceptInvite(API, "abc", "fake-token");

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
			headers: {Authorization: "fake-token-b"},
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
			headers: {Authorization: user.token},
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
			headers: {Authorization: user.token},
		});
		await new Promise((r) => setTimeout(r, 0));
		await fetchRetryOnce(API + "/users/@me", {
			headers: {Authorization: user.token},
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
			headers: {Authorization: user.token},
			body: JSON.stringify({password: "nope"}),
		});

		expect(probes).toBe(0);
		expect(user.loggedin).toBe(true);
		expect(nav).not.toHaveBeenCalled();
	});

	it("a rejecting probe releases the latch so a later 401 with a dead token still navigates", async () => {
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
			headers: {Authorization: user.token},
		});
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(user.loggedin).toBe(true);

		await fetchRetryOnce(API + "/users/@me/settings", {
			headers: {Authorization: user.token},
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
			headers: {Authorization: user.token},
			body: JSON.stringify({password: "nope"}),
		});
		await vi.waitFor(() => expect(probes).toBe(1));
		await new Promise((r) => setTimeout(r, 0));
		expect(nav).not.toHaveBeenCalled();
		expect(user.loggedin).toBe(true);

		tokenDead = true;
		await fetchRetryOnce(API + "/users/@me/delete", {
			method: "POST",
			headers: {Authorization: user.token},
			body: JSON.stringify({password: "nope"}),
		});
		await vi.waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
		expect(nav).toHaveBeenCalledWith("/login");
		expect(user.loggedin).toBe(false);
	});

	it("AbortSignal.any fallback still rejects with the offline DOMException when a caller signal is present and fetch hangs", async () => {
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		try {
			vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
			const controller = new AbortController();

			const err = await apiFetch(API + "/users/@me", {
				signal: controller.signal,
				timeoutMs: 25,
			}).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(DOMException);
			expect(err).toMatchObject({name: "TimeoutError", message: "offline"});
		} finally {
			if (realAbortSignalAny) Object.defineProperty(AbortSignal, "any", realAbortSignalAny);
		}
	}, 2_000);
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
			owner: {info: {api: API}, localuser: {userMap: new Map()}},
		}) as InstanceType<typeof Channel>;

		await channel.updateRolePermissions("r1", new Permissions("8", "4"));

		expect(document.body.textContent).toContain(I18n.requestFailed("Channel overwrite refused"));
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
});
