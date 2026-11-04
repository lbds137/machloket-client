import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://bkflow.test/api/v9";
const CHALLENGE_URL = API + "/auth/verify/view-backup-codes-challenge";
const VERIFY_URL = API + "/users/@me/mfa/codes-verification";
const TOTP_URL = API + "/users/@me/mfa/totp";

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

/** Records each form the build creates, keeping the real forms working. */
function capturePrompts() {
	const promptForms: SubForm[] = [];
	const subForms: SubForm[] = [];
	const addForm = Options.prototype.addForm;
	vi.spyOn(Options.prototype, "addForm").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: Parameters<typeof addForm>
	) {
		const form = addForm.apply(this, args);
		if (args[2]?.fetchURL === TOTP_URL) {
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
		info: {api: API, cdn: "", wellknown: "http://bkflow.test"},
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

function clickButton(label: string): HTMLButtonElement {
	const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === label,
	);
	expect(btn, `no button labeled "${label}"`).toBeDefined();
	btn!.click();
	return btn!;
}

/** Builds the settings page and opens the security pane (sections mount on click). */
async function openSecurityGrid(mfaEnabled = false) {
	stubUserSettings();
	const user = settingsUser(mfaEnabled);
	await user.showusersettings().catch(() => {});
	const tab = [...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")].find(
		(b) => b.textContent === I18n.localuser.accountSettings(),
	);
	expect(tab, "no account settings tab").not.toBeUndefined();
	tab!.click();
}

const gridCodes = () =>
	[...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent);

describe("view backup codes from the security grid", () => {
	it("the security grid offers the entry", async () => {
		await openSecurityGrid();
		expect(
			[...document.querySelectorAll<HTMLButtonElement>("button")].some(
				(b) => b.textContent === I18n.localuser.viewBackupCodes(),
			),
		).toBe(true);
	});

	it("password → challenge → codes-verification shows the codes; regenerate posts the regenerate nonce and replaces them", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		const {bodies: challengeSent} = captureWithHeaders(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean};
			if (body?.regenerate === true)
				return Response.json({backup_codes: [{code: "nEwC0de1", consumed: false}]});
			return Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		expect(challengeSent).toEqual([{password: "hunter22"}]);
		await vi.waitFor(() =>
			expect(verifySent).toEqual([{key: "hunter22", nonce: "n-view", regenerate: false}]),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(verifySent).toEqual([
				{key: "hunter22", nonce: "n-view", regenerate: false},
				{key: "hunter22", nonce: "n-regen", regenerate: true},
			]),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
	});

	it("60003 prompts for a code once; the header covers the retry and the regenerate without a second prompt", async () => {
		spyFetchHeaders();
		await openSecurityGrid(true);
		const {subForms, promptForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureWithHeaders(CHALLENGE_URL, () => Response.json({nonce: "mv", regenerate_nonce: "mr"}));
		const mfaRequired = () =>
			Response.json({code: 60003, message: "Two factor required"}, {status: 400});
		const {bodies: verifySent, headers: verifyHeaders} = captureWithHeaders(VERIFY_URL, (req) => {
			// every leg needs the MFA header; without it the server answers 60003
			if (req.headers.get("X-Discord-MFA-Authorization") !== "mfa-tok") return mfaRequired();
			const body = req.body as {regenerate?: boolean};
			if (body?.regenerate === true)
				return Response.json({backup_codes: [{code: "rEgen000", consumed: false}]});
			return Response.json({backup_codes: [{code: "mfaCode01", consumed: false}]});
		});
		const totpSent = captureRequests(TOTP_URL, () => Response.json({token: "mfa-tok"}));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		// Not awaited yet: the submit waits on the MFA prompt this test drives next.
		const done = form.submit();
		const prompt = await vi.waitFor(
			() => {
				// exactly one: the header-cached regenerate must not prompt again
				expect(promptForms).toHaveLength(1);
				return promptForms[0]!;
			},
			{timeout: 200},
		);
		prompt.names.get("code")!.value = "123456";
		await prompt.submit();
		await done;

		await vi.waitFor(() => expect(gridCodes()).toEqual(["mfaCode01"]));
		expect(totpSent).toEqual([{code: "123456"}]);

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() => expect(gridCodes()).toEqual(["rEgen000"]));
		// the cached header covered the regenerate: still exactly one code prompt
		expect(totpSent).toEqual([{code: "123456"}]);
		expect(verifySent).toEqual([
			// the headerless first attempt, the headered retry, then the regen
			{key: "hunter22", nonce: "mv", regenerate: false},
			{key: "hunter22", nonce: "mv", regenerate: false},
			{key: "hunter22", nonce: "mr", regenerate: true},
		]);
		expect(verifyHeaders).toHaveLength(3);
		expect(
			verifyHeaders.filter((h) => h.get("X-Discord-MFA-Authorization") === "mfa-tok"),
		).toHaveLength(2);
	});

	it("a rejected password puts the error on the field and never reaches codes-verification", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		const {bodies: challengeSent} = captureWithHeaders(CHALLENGE_URL, () =>
			Response.json({code: 400, message: "Password is invalid"}, {status: 400}),
		);
		const verifySent = captureRequests(VERIFY_URL, () => Response.json({}));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "wrong";
		await form.submit();

		expect(challengeSent).toEqual([{password: "wrong"}]);
		expect(verifySent).toHaveLength(0);
		expect(document.body.textContent).toContain(I18n.localuser.badPassword());
	});

	it("a 2xx answer that is not our JSON refuses visibly instead of closing the pane in silence", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		// Both shapes of a proxy's error page: unparseable text, then valid JSON
		// that isn't an answer object.
		let attempts = 0;
		captureRequests(VERIFY_URL, () => {
			attempts++;
			return attempts === 1
				? new Response("<html>proxy error</html>", {status: 200})
				: Response.json("ok");
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body"));
		expect(document.querySelector(".backupCodeGrid")).toBeNull();
	});

	it("a 2xx bad body on the regenerate leg refuses and keeps the last shown batch up", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			return body?.regenerate === true
				? new Response("<html>proxy error</html>", {status: 200})
				: Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body")),
		);
		// The server has already expired these; the dialog stays the last truth while
		// the refusal says the refresh failed.
		expect(gridCodes()).toEqual(["0ldC0de1"]);
	});
});
