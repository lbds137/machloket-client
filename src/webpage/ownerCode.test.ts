import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Dialog, Form, Options} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://owner.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	// Cleared here, not in manageApp: the captures register their arrays before manageApp runs,
	// and clearing there would orphan them, so the fetch spy would record nothing.
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

/** Opens application "a1"'s manage form for an owner, and returns the button callbacks it added
 * (by label), the sub-forms they open, and any MFA prompt forms opened by `handleMfa`. */
async function manageApp(app: object, mfaEnabled = true) {
	await I18n.done;
	const baseFetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
		const url = new URL(input instanceof Request ? input.url : input, location.href);
		headersByUrl.get(url.origin + url.pathname)?.push(new Headers(init?.headers));
		return baseFetch(input, init);
	});
	captureRequests(API + "/applications/a1", () => Response.json(app));
	const buttons = new Map<string, () => unknown>();
	vi.spyOn(Form.prototype, "addButtonInput").mockImplementation(function (
		this: InstanceType<typeof Form>,
		_label: string,
		text: string,
		onClick: () => void,
	) {
		buttons.set(text, onClick);
		return undefined as never;
	});
	const subForms: SubForm[] = [];
	const addSubForm = Form.prototype.addSubForm;
	vi.spyOn(Form.prototype, "addSubForm").mockImplementation(function (
		this: InstanceType<typeof Form>,
		...args: Parameters<typeof addSubForm>
	) {
		const sub = addSubForm.apply(this, args);
		subForms.push(sub as unknown as SubForm);
		return sub;
	});
	const promptForms: SubForm[] = [];
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
	const user = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		mfa_enabled: mfaEnabled,
		// `perminfo` reads the account's stored info.
		userinfo: {localuserStore: {applications: {}}},
		botTokens: new Map(),
		userMap: new Map(),
		guilds: [],
	});
	return {user, buttons, subForms, promptForms};
}

it("deleting an application prompts for TOTP on 60003 and retries with the MFA header", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/delete",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-1"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: null,
	});
	const dialog = new Dialog("");
	const returnFromSub = vi.spyOn(dialog.options, "returnFromSub");
	const onDelete = vi.fn();
	await user.manageApplication("a1", dialog.options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	const prompt = await vi.waitFor(() => {
		const p = promptForms.at(-1);
		if (!p) throw new Error("MFA prompt never opened");
		return p;
	});
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(sent).toEqual([{}, {}]);
	expect(totpSent).toEqual([{code: "123456"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null, "mfa-tok-1"]);
	expect(onDelete).toHaveBeenCalledOnce();
	expect(returnFromSub).toHaveBeenCalledOnce();
});

it("a wrong TOTP code shows the error on the prompt field without retrying the delete", async () => {
	const {bodies: sent} = captureWithHeaders(API + "/applications/a1/delete", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: null,
	});
	await user.manageApplication("a1", new Dialog("").options, () => {});

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	const prompt = await vi.waitFor(() => {
		const p = promptForms.at(-1);
		if (!p) throw new Error("MFA prompt never opened");
		return p;
	});
	prompt.names.get("code")!.value = "000000";
	await prompt.submit();

	expect(totpSent).toEqual([{code: "000000"}]);
	expect(sent).toEqual([{}]);
	const promptBg = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
	expect(promptBg?.querySelector(".suberror")?.textContent).toBe("Invalid two-factor code");

	promptBg?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
	await done;
});

it("resetting a bot's token prompts for TOTP on 60003, retries with the MFA header, and shows the new token", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/bot/reset",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? Response.json({token: "new-token"})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "mfa-tok-2"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: {id: "1553128617381273639", username: "bot", discriminator: "0", avatar: null},
	});
	const dialog = new Dialog("");
	dialog.show();
	await user.manageBot("a1", dialog.options as never);

	await buttons.get(I18n.localuser.resetToken())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	const prompt = await vi.waitFor(() => {
		const p = promptForms.at(-1);
		if (!p) throw new Error("MFA prompt never opened");
		return p;
	});
	prompt.names.get("code")!.value = "654321";
	await prompt.submit();
	await done;

	expect(sent).toEqual([{}, {}]);
	expect(totpSent).toEqual([{code: "654321"}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null, "mfa-tok-2"]);
	expect(user.botTokens.get("a1")).toBe("new-token");
	expect(document.body.textContent).toContain(I18n.localuser.tokenDisplay("new-token"));
});

it("a refused token reset keeps the token it had", async () => {
	const {bodies: sent} = captureWithHeaders(API + "/applications/a1/bot/reset", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: {id: "1553128617381273639", username: "bot", discriminator: "0", avatar: null},
	});
	await user.manageBot("a1", new Dialog("").options as never);

	await buttons.get(I18n.localuser.resetToken())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	const prompt = await vi.waitFor(() => {
		const p = promptForms.at(-1);
		if (!p) throw new Error("MFA prompt never opened");
		return p;
	});
	prompt.names.get("code")!.value = "000000";
	await prompt.submit();
	const promptBg = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
	promptBg?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
	await done;

	expect(sent).toEqual([{}]);
	expect(totpSent).toEqual([{code: "000000"}]);
	expect(user.botTokens.has("a1")).toBe(false);
});

it("a fresh cached MFA token retries with the header without opening the prompt", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/delete",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "unexpected"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: null,
	});
	(user as unknown as {mfaAuth: {token: string; exp: number}}).mfaAuth = {
		token: "cached-mfa-tok",
		exp: Date.now() + 60_000,
	};
	const onDelete = vi.fn();
	await user.manageApplication("a1", new Dialog("").options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	await sub.submit();

	expect(promptForms).toHaveLength(0);
	expect(totpSent).toEqual([]);
	expect(sent).toEqual([{}, {}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"cached-mfa-tok",
	]);
	expect(onDelete).toHaveBeenCalledOnce();
});

it("an expired cached MFA token opens the prompt instead of retrying with the stale token", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/delete",
		({headers}) =>
			headers.get("x-discord-mfa-authorization") === "fresh-tok"
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "fresh-tok"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: null,
	});
	(user as unknown as {mfaAuth: {token: string; exp: number}}).mfaAuth = {
		token: "stale-tok",
		exp: Date.now() - 1000,
	};
	await user.manageApplication("a1", new Dialog("").options, () => {});

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	const prompt = await vi.waitFor(() => {
		const p = promptForms.at(-1);
		if (!p) throw new Error("MFA prompt never opened");
		return p;
	});
	prompt.names.get("code")!.value = "123456";
	await prompt.submit();
	await done;

	expect(promptForms).toHaveLength(1);
	expect(totpSent).toEqual([{code: "123456"}]);
	expect(sent).toEqual([{}, {}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null, "fresh-tok"]);
});

it("a cached MFA token refused with 60003 on retry is forgotten, shows the refusal, and stops after two requests", async () => {
	const {bodies: sent, headers} = captureWithHeaders(API + "/applications/a1/delete", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const {user, buttons, subForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: null,
	});
	(user as unknown as {mfaAuth?: {token: string; exp: number}}).mfaAuth = {
		token: "rejected-tok",
		exp: Date.now() + 60_000,
	};
	const onDelete = vi.fn();
	await user.manageApplication("a1", new Dialog("").options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	const mfaRetry = (sub as unknown as {mfaRetry?: {store?: (t: string | null) => void}}).mfaRetry;
	const storeSpy = mfaRetry?.store ? vi.spyOn(mfaRetry, "store") : undefined;
	await sub.submit();

	expect(sent).toEqual([{}, {}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null, "rejected-tok"]);
	expect(storeSpy).toHaveBeenCalledWith(null);
	expect((user as unknown as {mfaAuth?: unknown}).mfaAuth).toBeUndefined();
	expect(document.body.textContent).toContain("Two factor required");
	expect(onDelete).not.toHaveBeenCalled();
});

it("a webauthn-only owner runs the two-phase passkey flow on 60003 and retries with the MFA header", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/delete",
		({headers}) =>
			headers.get("x-discord-mfa-authorization")
				? new Response(null, {status: 204})
				: Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const {bodies: webauthnSent} = captureWithHeaders(API + "/users/@me/mfa/webauthn", ({body}) =>
		(body as {ticket?: string})?.ticket
			? Response.json({token: "webauthn-mfa-tok"})
			: Response.json({
					ticket: "t1",
					challenge: JSON.stringify({publicKey: {challenge: "abc="}}),
				}),
	);
	const rawId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
	const authenticatorData = new Uint8Array([9, 10]).buffer;
	const clientDataJSON = new Uint8Array([11, 12]).buffer;
	const signature = new Uint8Array([13, 14]).buffer;
	vi.spyOn(navigator.credentials, "get").mockResolvedValue({
		rawId,
		response: {authenticatorData, clientDataJSON, signature},
	} as never);
	const {user, buttons, subForms, promptForms} = await manageApp(
		{id: "a1", name: "App", bot: null},
		false,
	);
	const onDelete = vi.fn();
	await user.manageApplication("a1", new Dialog("").options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	await sub.submit();

	const expectedCode = JSON.stringify({
		rawId: btoa(String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8)),
		response: {
			authenticatorData: btoa(String.fromCharCode(9, 10)),
			clientDataJSON: btoa(String.fromCharCode(11, 12)),
			signature: btoa(String.fromCharCode(13, 14)),
		},
	});
	expect(promptForms).toHaveLength(0);
	expect(webauthnSent).toEqual([{}, {ticket: "t1", code: expectedCode}]);
	expect(sent).toEqual([{}, {}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([
		null,
		"webauthn-mfa-tok",
	]);
	expect(onDelete).toHaveBeenCalledOnce();
});

it("a no-factor owner whose delete succeeds with 204 sends one request and opens no prompt", async () => {
	const {bodies: sent, headers} = captureWithHeaders(
		API + "/applications/a1/delete",
		() => new Response(null, {status: 204}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "unexpected"}),
	);
	const webauthnSent = captureRequests(API + "/users/@me/mfa/webauthn", () =>
		Response.json({token: "unexpected"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp(
		{id: "a1", name: "App", bot: null},
		false,
	);
	const onDelete = vi.fn();
	await user.manageApplication("a1", new Dialog("").options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	await sub.submit();

	expect((sub as unknown as {mfaRetry?: {factor: string}}).mfaRetry?.factor).toBe("webauthn");
	expect(sent).toEqual([{}]);
	expect(headers.map((h) => h.get("x-discord-mfa-authorization"))).toEqual([null]);
	expect(promptForms).toHaveLength(0);
	expect(totpSent).toEqual([]);
	expect(webauthnSent).toEqual([]);
	expect(onDelete).toHaveBeenCalledOnce();
});

it("a malformed webauthn challenge refuses with a message instead of dead-ending the form", async () => {
	const {bodies: sent} = captureWithHeaders(API + "/applications/a1/delete", () =>
		Response.json({code: 60003, message: "Two factor required"}, {status: 400}),
	);
	const webauthnSent = captureRequests(API + "/users/@me/mfa/webauthn", () =>
		Response.json({ticket: "t1", challenge: "not-json"}),
	);
	const {user, buttons, subForms, promptForms} = await manageApp(
		{id: "a1", name: "App", bot: null},
		false,
	);
	const onDelete = vi.fn();
	await user.manageApplication("a1", new Dialog("").options, onDelete);

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	const done = sub.submit();
	await done;

	expect(webauthnSent).toEqual([{}]);
	expect(sent).toEqual([{}]);
	expect(promptForms).toHaveLength(0);
	expect(document.body.textContent).toContain("bad challenge");
	expect(onDelete).not.toHaveBeenCalled();
});
