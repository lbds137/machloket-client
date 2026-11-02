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
	// The create POST shares the generate call's token: no second prompt for one action.
	await vi.waitFor(() => expect(headers).toHaveLength(3));
	expect(headers[2]!.get("x-discord-mfa-authorization")).toBe("mfa-tok-key");
	expect(promptForms).toHaveLength(1);
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
	// The key's own row leaves the list, not just its Delete button.
	expect(
		[...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === "YubiKey",
		),
	).toBeUndefined();
});

// Localuser.headers spells it `Content-type`. A second spelling doesn't replace it: fetch joins
// them into one value the server's body parser refuses with a 415.
const SESSION_HEADERS = {
	Authorization: "t",
	"Content-type": "application/json; charset=UTF-8",
};

it("the code prompt's request carries one JSON content type", async () => {
	const {promptForms} = capturePrompts();
	const {headers} = captureWithHeaders(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok"}),
	);
	spyFetchHeaders();

	const done = fetchWithMfa(
		{factor: "totp"},
		API,
		SESSION_HEADERS,
		async (mfaHeaders) =>
			mfaHeaders["X-Discord-MFA-Authorization"]
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
		() => {},
	);
	const prompt = await vi.waitFor(() => {
		expect(promptForms).toHaveLength(1);
		return promptForms[0]!;
	});
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(headers.map((h) => h.get("content-type"))).toEqual(["application/json"]);
	expect(headers[0]!.get("authorization")).toBe("t");
});

it("the security key prompt's request carries one JSON content type", async () => {
	const {headers} = captureWithHeaders(API + "/users/@me/mfa/webauthn", () =>
		Response.json({message: "stop after the first step"}, {status: 400}),
	);
	spyFetchHeaders();

	await fetchWithMfa(
		{factor: "webauthn"},
		API,
		SESSION_HEADERS,
		async () => Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
		() => {},
	);

	expect(headers.map((h) => h.get("content-type"))).toEqual(["application/json"]);
	expect(headers[0]!.get("authorization")).toBe("t");
});

it("a double click on a key's Delete sends one request and shows one prompt", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () =>
		Response.json([{id: "k1", name: "YubiKey"}]),
	);
	const {headers} = captureWithHeaders(API + "/users/@me/mfa/webauthn/credentials/k1", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);

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
	delBtn.click();

	await vi.waitFor(() => expect(promptForms.length).toBeGreaterThan(0));
	expect(headers).toHaveLength(1);
	expect(promptForms).toHaveLength(1);
});

// A key-only account: mfa_enabled stays false, so the factor is the key, never a TOTP form.
function stubKeyPrompt(answer: "signed" | "cancelled") {
	const stepBodies = captureRequests(API + "/users/@me/mfa/webauthn", () =>
		stepBodies.length === 1
			? Response.json({
					ticket: "t-key",
					challenge: JSON.stringify({publicKey: {challenge: "abc="}}),
				})
			: Response.json({token: "mfa-tok-webauthn"}),
	);
	vi.spyOn(PublicKeyCredential, "parseRequestOptionsFromJSON").mockReturnValue({} as never);
	const buf = new Uint8Array([1, 2]).buffer;
	const get = vi.spyOn(navigator.credentials, "get");
	if (answer === "signed") {
		get.mockResolvedValue({
			rawId: buf,
			response: {authenticatorData: buf, clientDataJSON: buf, signature: buf},
		} as never);
	} else {
		get.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
	}
	return {stepBodies, get};
}

async function openKeyDelete(user: InstanceType<typeof Localuser>) {
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
	return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === I18n.delete(),
	)!;
}

it("key-only: removing a key asks the key, not a TOTP code, and retries with its token", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms} = capturePrompts();
	const {stepBodies, get} = stubKeyPrompt("signed");
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
	const deleteElmSpy = vi.spyOn(Options.prototype, "deleteElm");

	(await openKeyDelete(settingsUser(false))).click();

	await vi.waitFor(() => expect(deleteElmSpy).toHaveBeenCalledOnce());
	expect(get).toHaveBeenCalledOnce();
	expect(promptForms).toHaveLength(0);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-webauthn",
	]);
	const [first, second] = stepBodies as [object, {ticket: string; code: string}];
	expect(first).toEqual({});
	expect(second.ticket).toBe("t-key");
	expect(JSON.parse(second.code)).toEqual({
		rawId: "AQI=",
		response: {authenticatorData: "AQI=", clientDataJSON: "AQI=", signature: "AQI="},
	});
});

it("key-only: cancelling the key sends no retry and leaves Delete working", async () => {
	await I18n.done;
	spyFetchHeaders();
	stubUserSettings();
	const {promptForms} = capturePrompts();
	const {get} = stubKeyPrompt("cancelled");
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () =>
		Response.json([{id: "k1", name: "YubiKey"}]),
	);
	const {headers} = captureWithHeaders(API + "/users/@me/mfa/webauthn/credentials/k1", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const deleteElmSpy = vi.spyOn(Options.prototype, "deleteElm");

	const del = await openKeyDelete(settingsUser(false));
	del.click();
	await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
	await vi.waitFor(() =>
		expect(
			[...document.querySelectorAll(".background")].at(-1)?.textContent,
		).toContain("Two factor required"),
	);
	expect(headers).toHaveLength(1);
	expect(promptForms).toHaveLength(0);
	expect(deleteElmSpy).not.toHaveBeenCalled();

	del.click();
	await vi.waitFor(() => expect(headers).toHaveLength(2));
});

it("key-only: guild delete has no code field, asks the key, and retries with its token", async () => {
	await I18n.done;
	spyFetchHeaders();
	const {promptForms} = capturePrompts();
	const {get} = stubKeyPrompt("signed");
	const {headers} = captureWithHeaders(API + "/guilds/g1/delete", ({headers}) =>
		headers.get("x-discord-mfa-authorization")
			? new Response(null, {status: 204})
			: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const {form, hide} = confirmDeleteOf(false);
	expect(form.names.has("code")).toBe(false);
	form.names.get("")!.value = "Home";

	await form.submit();

	expect(get).toHaveBeenCalledOnce();
	expect(promptForms).toHaveLength(0);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"mfa-tok-webauthn",
	]);
	expect(hide).toHaveBeenCalledOnce();
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

it("TOTP enable answered with backup_codes shows the backup codes screen, sets mfa_enabled true, and closes the subform", async () => {
	await I18n.done;
	stubUserSettings();
	const {subForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/totp/enable/", () =>
		Response.json({
			token: "new-tok",
			backup_codes: [
				{code: "aaaa1111", consumed: false},
				{code: "bbbb2222", consumed: false},
			],
		}),
	);
	const user = settingsUser(false);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.localuser["2faEnable"]())!
		.click();

	const sub = subForms.at(-1)!;
	sub.names.get("password")!.value = "pw";
	sub.names.get("code")!.value = "123456";
	await sub.submit();

	expect(user.mfa_enabled).toBe(true);
	expect((sub as unknown as {owner: {subOptions: unknown}}).owner.subOptions).toBeUndefined();
	expect([...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent)).toEqual([
		"aaaa1111",
		"bbbb2222",
	]);
});

it("TOTP enable answered with {} shows no .backupCodeGrid", async () => {
	await I18n.done;
	stubUserSettings();
	const {subForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/totp/enable/", () => Response.json({}));
	const user = settingsUser(false);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.localuser["2faEnable"]())!
		.click();

	const sub = subForms.at(-1)!;
	sub.names.get("password")!.value = "pw";
	sub.names.get("code")!.value = "123456";
	await sub.submit();

	expect(user.mfa_enabled).toBe(true);
	expect((sub as unknown as {owner: {subOptions: unknown}}).owner.subOptions).toBeUndefined();
	expect(document.querySelector(".backupCodeGrid")).toBeNull();
});

it("first key enrollment with backup_codes lists the key and shows the screen; key without backup_codes lists the key and shows no screen", async () => {
	await I18n.done;
	stubUserSettings();
	const {subForms} = capturePrompts();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () => Response.json([]));
	const user = settingsUser(false);
	await user.showusersettings();
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.webauth.manage())!
		.click();

	vi.spyOn(PublicKeyCredential, "parseCreationOptionsFromJSON").mockReturnValue({} as never);
	const buf = new Uint8Array([1, 2]).buffer;
	vi.spyOn(navigator.credentials, "create").mockResolvedValue({
		rawId: buf,
		response: {attestationObject: buf, clientDataJSON: buf},
	} as never);

	let createAnswer: Record<string, unknown> = {
		id: "k1",
		name: "First Key",
		backup_codes: [{code: "cccc3333", consumed: false}],
	};
	const bodies = captureRequests(API + "/users/@me/mfa/webauthn/credentials", () => {
		const body = bodies.at(-1) as {ticket?: string} | undefined;
		if (body?.ticket) {
			return Response.json(createAnswer);
		}
		return Response.json({
			ticket: "t-gen",
			challenge: JSON.stringify({publicKey: {challenge: "abc="}}),
		});
	});

	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.webauth.addKey())!
		.click();
	const sub1 = subForms.at(-1)!;
	sub1.names.get("password")!.value = "pw";
	await sub1.submit();

	await vi.waitFor(() =>
		expect([...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent)).toEqual([
			"cccc3333",
		]),
	);
	expect(
		[...document.querySelectorAll<HTMLButtonElement>("button")].some(
			(b) => b.textContent === "First Key",
		),
	).toBe(true);

	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.backupCodes.done())!
		.click();
	await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
	createAnswer = {id: "k2", name: "Second Key"};

	[...document.querySelectorAll<HTMLButtonElement>("button")]
		.find((b) => b.textContent === I18n.webauth.addKey())!
		.click();
	const sub2 = subForms.at(-1)!;
	sub2.names.get("password")!.value = "pw";
	await sub2.submit();

	await vi.waitFor(() =>
		expect(
			[...document.querySelectorAll<HTMLButtonElement>("button")].some(
				(b) => b.textContent === "Second Key",
			),
		).toBe(true),
	);
	expect(document.querySelector(".backupCodeGrid")).toBeNull();
});
