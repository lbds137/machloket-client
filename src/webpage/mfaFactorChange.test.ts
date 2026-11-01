import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Dialog, fetchWithMfa, Options} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://mfa.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	headersByUrl.clear();
	document.body.replaceChildren();
});

type SubForm = {submit(): Promise<void>; names: Map<string, {value: string}>};

const headersByUrl = new Map<string, Headers[]>();

function captureWithHeaders(
	url: string,
	respond: (req: {body: unknown; headers: Headers}) => Response | Promise<Response>,
) {
	const headers: Headers[] = [];
	headersByUrl.set(url, headers);
	const bodies = captureRequests(url, () =>
		respond({body: bodies.at(-1), headers: headers.at(-1)!}),
	);
	return {bodies, headers};
}

function spyFetchHeaders() {
	const baseFetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
		const url = new URL(input instanceof Request ? input.url : input, location.href);
		headersByUrl.get(url.origin + url.pathname)?.push(new Headers(init?.headers));
		return baseFetch(input, init);
	});
}

function capturePrompts() {
	const promptForms: SubForm[] = [];
	const subForms: SubForm[] = [];
	const addForm = Options.prototype.addForm;
	vi.spyOn(Options.prototype, "addForm").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: Parameters<typeof addForm>
	) {
		const form = addForm.apply(this, args);
		if (args[2]?.fetchURL?.endsWith("/users/@me/mfa/totp")) {
			promptForms.push(form as unknown as SubForm);
		}
		return form;
	});
	const addSubForm = Options.prototype.addSubForm;
	vi.spyOn(Options.prototype, "addSubForm").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: Parameters<typeof addSubForm>
	) {
		const sub = addSubForm.apply(this, args);
		subForms.push(sub as unknown as SubForm);
		return sub;
	});
	return {promptForms, subForms};
}

function settingsUser(mfaEnabled = false) {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://mfa.test"},
		headers: {Authorization: "t"},
		mfa_enabled: mfaEnabled,
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
}

function stubUserSettings() {
	captureRequests(API + "/users/@me/connections", () => Response.json([]));
	captureRequests(API + "/connections", () => Response.json({github: {enabled: true}}));
	captureRequests(API + "/teams", () => Response.json([]));
	captureRequests(API + "/applications", () => Response.json([]));
	captureRequests(API + "/policies/instance/", () => Response.json({instanceName: "T"}));
	captureRequests(API + "/auth/sessions", () => Response.json({user_sessions: []}));
}

function confirmDeleteOf(mfaEnabled: boolean) {
	const showSpy = vi.spyOn(Dialog.prototype, "show");
	const owner = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		mfa_enabled: mfaEnabled,
	});
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		properties: {name: "Home"},
		headers: {Authorization: "t"},
		owner,
	});
	guild.confirmDelete();
	const dialog = showSpy.mock.instances[0] as unknown as InstanceType<typeof Dialog>;
	const hide = vi.spyOn(dialog, "hide");
	const form = dialog.options.options.find((o) => "names" in o) as unknown as SubForm;
	return {form, hide, owner};
}

it("guild delete prompts for TOTP on 60003, retries with X-Discord-MFA-Authorization, and closes the dialog", async () => {
	await I18n.done;
	spyFetchHeaders();
	const {promptForms} = capturePrompts();
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/guilds/g1/delete",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-guild"}),
	);
	const {form, hide} = confirmDeleteOf(true);
	form.names.get("")!.value = "Home";
	form.names.get("code")!.value = "111111";

	const done = form.submit();
	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(sent).toEqual([{code: "111111"}, {code: "111111"}]);
	expect(totpSent).toEqual([{code: "123456"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-guild",
	]);
	expect(hide).toHaveBeenCalledOnce();
});

it("TOTP enable prompts on 60003, retries with X-Discord-MFA-Authorization, and closes the subform", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms, subForms} = capturePrompts();
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/users/@me/mfa/totp/enable/",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? Response.json({})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-totp"}),
	);
	const user = settingsUser(false);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	const enableBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === I18n.localuser["2faEnable"](),
	)!;
	// Drive the TOTP code prompt path through mfaRetry().
	user.mfa_enabled = true;
	enableBtn.click();

	const sub = subForms.at(-1)!;
	sub.names.get("password")!.value = "pw";
	sub.names.get("code")!.value = "654321";
	const done = sub.submit();
	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(sent).toHaveLength(2);
	expect(totpSent).toEqual([{code: "123456"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-totp",
	]);
	expect((sub as unknown as {owner: {subOptions: unknown}}).owner.subOptions).toBeUndefined();
});

it("adding a passkey prompts on 60003 during generate, retries with X-Discord-MFA-Authorization, and closes the subform", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms, subForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () => Response.json([]));
	const user = settingsUser(true);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.webauth.manage())!
		.click();

	const {bodies: sent, headers} = captureWithHeaders(
		API + "/users/@me/mfa/webauthn/credentials",
		({body, headers}) => {
			if (!headers.get("x-discord-mfa-authorization")) {
				return Response.json({code: 60003, message: "Two factor required"}, {status: 400});
			}
			if ((body as {ticket?: string})?.ticket) {
				return Response.json({id: "k1", name: "Key 1"});
			}
			return Response.json({
				ticket: "t-gen",
				challenge: JSON.stringify({publicKey: {challenge: "abc="}}),
			});
		},
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-key"}),
	);
	vi.spyOn(PublicKeyCredential, "parseCreationOptionsFromJSON").mockReturnValue({} as never);
	const buf = new Uint8Array([1, 2]).buffer;
	vi.spyOn(navigator.credentials, "create").mockResolvedValue({
		rawId: buf,
		response: {attestationObject: buf, clientDataJSON: buf},
	} as never);

	const addKeyBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === I18n.webauth.addKey(),
	)!;
	addKeyBtn.click();
	const sub = subForms.at(-1)!;
	sub.names.get("password")!.value = "pw";

	const done = sub.submit();
	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(totpSent).toEqual([{code: "123456"}]);
	expect(sent.slice(0, 2)).toEqual([{password: "pw"}, {password: "pw"}]);
	expect(headers.slice(0, 2).map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-key",
	]);
	expect((sub as unknown as {owner: {subOptions: unknown}}).owner.subOptions).toBeUndefined();
});

it("fetchWithMfa: 60003 then success sends exactly twice, the second with the header", async () => {
	await I18n.done;
	const {promptForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/totp", () => Response.json({token: "fresh-mfa"}));
	let stored: string | null = null;
	const retry = {
		factor: "totp" as const,
		token: () => stored,
		store: (t: string | null) => {
			stored = t;
		},
	};
	const sentHeaders: Record<string, string>[] = [];
	const done = fetchWithMfa(
		retry,
		API,
		{Authorization: "t"},
		async (mfaHeaders) => {
			sentHeaders.push(mfaHeaders);
			return mfaHeaders["X-Discord-MFA-Authorization"]
				? Response.json({ok: true})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400});
		},
		() => {},
	);
	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	const res = await done;

	expect(sentHeaders).toEqual([{}, {"X-Discord-MFA-Authorization": "fresh-mfa"}]);
	expect(stored).toBe("fresh-mfa");
	expect(await res?.json()).toEqual({ok: true});
});

it("fetchWithMfa: 60003 twice sends exactly twice and returns the second answer, with the token forgotten", async () => {
	await I18n.done;
	const {promptForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/totp", () => Response.json({token: "minted-tok"}));
	let stored: string | null = "stale-cached-tok";
	const storeCalls: (string | null)[] = [];
	const retry = {
		factor: "totp" as const,
		token: () => stored,
		store: (t: string | null) => {
			storeCalls.push(t);
			stored = t;
		},
	};
	const sentHeaders: Record<string, string>[] = [];
	let call = 0;
	const done = fetchWithMfa(
		retry,
		API,
		{Authorization: "t"},
		async (mfaHeaders) => {
			sentHeaders.push(mfaHeaders);
			call++;
			return Response.json({code: 60003, attempt: call}, {status: 400});
		},
		() => {},
	);
	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	const res = await done;

	expect(sentHeaders).toEqual([
		{"X-Discord-MFA-Authorization": "stale-cached-tok"},
		{"X-Discord-MFA-Authorization": "minted-tok"},
	]);
	expect(stored).toBeNull();
	expect(storeCalls).toEqual([null, "minted-tok", null]);
	expect(await res?.json()).toEqual({code: 60003, attempt: 2});
});

it("fetchWithMfa: a cached token is sent on the first try", async () => {
	await I18n.done;
	const {promptForms} = capturePrompts();
	const sentHeaders: Record<string, string>[] = [];
	const res = await fetchWithMfa(
		{
			factor: "totp",
			token: () => "cached-tok",
			store: () => {},
		},
		API,
		{Authorization: "t"},
		async (mfaHeaders) => {
			sentHeaders.push(mfaHeaders);
			return Response.json({deleted: true});
		},
		() => {},
	);

	expect(sentHeaders).toEqual([{"X-Discord-MFA-Authorization": "cached-tok"}]);
	expect(promptForms).toHaveLength(0);
	expect(await res?.json()).toEqual({deleted: true});
});

it("fetchWithMfa: dismissing the prompt returns the 60003 answer and sends once", async () => {
	await I18n.done;
	const {promptForms} = capturePrompts();
	const sentHeaders: Record<string, string>[] = [];
	const done = fetchWithMfa(
		{
			factor: "totp",
			token: () => null,
			store: () => {},
		},
		API,
		{Authorization: "t"},
		async (mfaHeaders) => {
			sentHeaders.push(mfaHeaders);
			return Response.json({code: 60003, message: "Two factor required"}, {status: 400});
		},
		() => {},
	);
	await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
		},
		{timeout: 200},
	);
	const promptBg = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
	promptBg?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
	const res = await done;

	expect(sentHeaders).toEqual([{}]);
	expect(res?.status).toBe(400);
	expect(await res?.json()).toEqual({code: 60003, message: "Two factor required"});
});

it("fetchWithMfa: a 200 with no factor sends once with no header, never prompts, and leaves the body readable", async () => {
	await I18n.done;
	const {promptForms} = capturePrompts();
	const sentHeaders: Record<string, string>[] = [];
	const res = await fetchWithMfa(
		{
			factor: "webauthn",
			token: () => null,
			store: () => {},
		},
		API,
		{Authorization: "t"},
		async (mfaHeaders) => {
			sentHeaders.push(mfaHeaders);
			return Response.json({id: "k1", name: "Passkey"});
		},
		() => {},
	);

	expect(sentHeaders).toEqual([{}]);
	expect(promptForms).toHaveLength(0);
	expect(await res?.json()).toEqual({id: "k1", name: "Passkey"});
});

it("credential DELETE through the settings UI retries with X-Discord-MFA-Authorization on 60003", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () =>
		Response.json([{id: "k1", name: "YubiKey"}]),
	);
	const {headers} = captureWithHeaders(
		API + "/users/@me/mfa/webauthn/credentials/k1",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-del"}),
	);
	const deleteElmSpy = vi.spyOn(Options.prototype, "deleteElm");

	const user = settingsUser(true);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.webauth.manage())!
		.click();

	const keyBtn = await vi.waitFor(() => {
		const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === "YubiKey",
		);
		expect(b).toBeDefined();
		return b!;
	});
	keyBtn.click();

	const delBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === I18n.delete(),
	)!;
	delBtn.click();

	const prompt = await vi.waitFor(
		() => {
			expect(promptForms).toHaveLength(1);
			return promptForms[0]!;
		},
		{timeout: 200},
	);
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();

	await vi.waitFor(() => {
		expect(deleteElmSpy).toHaveBeenCalledOnce();
	});
	expect(totpSent).toEqual([{code: "123456"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-del",
	]);
	expect(
		[...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === I18n.delete(),
		),
	).toBeUndefined();
});

it("control: guild delete with a body code and no 60003 sends once", async () => {
	await I18n.done;
	spyFetchHeaders();
	const {promptForms} = capturePrompts();
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/guilds/g1/delete",
		() => new Response(null, {status: 204}),
	);
	const {form, hide} = confirmDeleteOf(true);
	form.names.get("")!.value = "Home";
	form.names.get("code")!.value = "123456";

	await form.submit();

	expect(sent).toEqual([{code: "123456"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null]);
	expect(promptForms).toHaveLength(0);
	expect(hide).toHaveBeenCalledOnce();
});

it("control: guild delete with a wrong code's 60008 shows the error on its field", async () => {
	await I18n.done;
	spyFetchHeaders();
	const {promptForms} = capturePrompts();
	const {bodies: sent} = captureWithHeaders(API + "/guilds/g1/delete", () =>
		Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400}),
	);
	const {form, hide} = confirmDeleteOf(true);
	form.names.get("")!.value = "Home";
	form.names.get("code")!.value = "000000";

	await form.submit();

	expect(sent).toEqual([{code: "000000"}]);
	expect(promptForms).toHaveLength(0);
	expect(hide).not.toHaveBeenCalled();
	expect(document.querySelector(".suberror")?.textContent).toBe(I18n.localuser.badCode());
});
