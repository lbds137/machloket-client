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

	it("the codes-verification View path shows viewExplain and not explain", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		captureRequests(VERIFY_URL, () =>
			Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]}),
		);

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));
		expect(document.body.textContent).toContain(I18n.backupCodes.viewExplain());
		expect(document.body.textContent).not.toContain(I18n.backupCodes.explain());
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
			Response.json(
				{
					code: 50035,
					message: "Invalid Form Body",
					errors: {
						password: {
							_errors: [{code: "INVALID_PASSWORD", message: "Password is invalid"}],
						},
					},
				},
				{status: 400},
			),
		);
		const verifySent = captureRequests(VERIFY_URL, () => Response.json({}));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "wrong";
		await form.submit();

		expect(challengeSent).toEqual([{password: "wrong"}]);
		expect(verifySent).toHaveLength(0);
		expect(document.body.textContent).toContain("Password is invalid");
	});

	it("a bare {code: 400} challenge refusal falls back to onErrorBody and never reaches codes-verification", async () => {
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

	it("a 2xx challenge answer without nonces refuses visibly instead of closing the pane in silence", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () => Response.json({}));
		const verifySent = captureRequests(VERIFY_URL, () => Response.json({}));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		expect(verifySent).toHaveLength(0);
		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body"));
		expect(document.querySelector(".backupCodeGrid")).toBeNull();
	});

	it("a 2xx HTML answer on the view leg refuses visibly instead of closing the pane in silence", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		captureRequests(VERIFY_URL, () => new Response("<html>proxy error</html>", {status: 200}));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body"));
		expect(document.querySelector(".backupCodeGrid")).toBeNull();
	});

	it("a 2xx non-object JSON answer on the view leg refuses visibly instead of closing the pane in silence", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		captureRequests(VERIFY_URL, () => Response.json("ok"));

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();

		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body"));
		expect(document.querySelector(".backupCodeGrid")).toBeNull();
	});

	it("disables Done, Copy, Download and Regenerate while a regenerate is in flight so Done cannot dismiss past the new batch", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let releaseRegen!: () => void;
		const regenGate = new Promise<void>((r) => {
			releaseRegen = r;
		});
		captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean};
			if (body?.regenerate === true) {
				return regenGate.then(() =>
					Response.json({backup_codes: [{code: "nEwC0de1", consumed: false}]}),
				);
			}
			return Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		const findBtn = (label: string) =>
			[...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.textContent === label,
			)!;
		const doneBtn = findBtn(I18n.backupCodes.done());
		const copyBtn = findBtn(I18n.backupCodes.copy());
		const downloadBtn = findBtn(I18n.backupCodes.download());
		const regenBtn = findBtn(I18n.backupCodes.regenerate());

		regenBtn.click();
		expect(doneBtn.disabled).toBe(true);
		expect(copyBtn.disabled).toBe(true);
		expect(downloadBtn.disabled).toBe(true);
		expect(regenBtn.disabled).toBe(true);
		expect(regenBtn.getAttribute("aria-busy")).toBe("true");

		doneBtn.click();
		releaseRegen();

		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
		expect(document.querySelector(".backupCodeGrid")).not.toBeNull();
		expect(doneBtn.disabled).toBe(false);
		expect(copyBtn.disabled).toBe(false);
		expect(downloadBtn.disabled).toBe(false);
		expect(regenBtn.disabled).toBe(false);
		expect(regenBtn.getAttribute("aria-busy")).toBeNull();
	});

	it("a failed regenerate re-reads with the view nonce and shows the new batch the server holds", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean};
			if (body?.regenerate === true) {
				return new Response("err", {status: 500});
			}
			viewCalls++;
			return Response.json({
				backup_codes: [{code: viewCalls === 1 ? "0ldC0de1" : "nEwC0de1", consumed: false}],
			});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 500")),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
		expect(verifySent).toEqual([
			{key: "hunter22", nonce: "n-view", regenerate: false},
			{key: "hunter22", nonce: "n-regen", regenerate: true},
			{key: "hunter22", nonce: "n-view", regenerate: false},
		]);
	});

	it("a failed regenerate whose follow-up view read also fails hides the grid so dead codes never stay on screen", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean};
			if (body?.regenerate === true) {
				return new Response("err", {status: 500});
			}
			viewCalls++;
			return viewCalls === 1
				? Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]})
				: new Response("err", {status: 500});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 500")),
		);
		await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
		expect(verifySent).toEqual([
			{key: "hunter22", nonce: "n-view", regenerate: false},
			{key: "hunter22", nonce: "n-regen", regenerate: true},
			{key: "hunter22", nonce: "n-view", regenerate: false},
		]);
	});

	it("a 2xx HTML answer on the regenerate leg refuses, re-reads with the view nonce, and hides the grid when no codes remain", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			if (body?.regenerate === true) {
				return new Response("<html>proxy error</html>", {status: 200});
			}
			viewCalls++;
			return viewCalls === 1
				? Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]})
				: Response.json({backup_codes: []});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body")),
		);
		await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
		expect(verifySent).toEqual([
			{key: "hunter22", nonce: "n-view", regenerate: false},
			{key: "hunter22", nonce: "n-regen", regenerate: true},
			{key: "hunter22", nonce: "n-view", regenerate: false},
		]);
	});

	it("a 2xx non-object JSON answer on the regenerate leg refuses, re-reads with the view nonce, and updates the grid", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			if (body?.regenerate === true) {
				return Response.json("ok");
			}
			viewCalls++;
			return Response.json({
				backup_codes: [{code: viewCalls === 1 ? "0ldC0de1" : "nEwC0de1", consumed: false}],
			});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body")),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
		expect(verifySent).toEqual([
			{key: "hunter22", nonce: "n-view", regenerate: false},
			{key: "hunter22", nonce: "n-regen", regenerate: true},
			{key: "hunter22", nonce: "n-view", regenerate: false},
		]);
	});

	it("a 4xx regenerate refusal keeps the shown codes and never re-reads: the server expired nothing", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			// The server checks MFA and the nonce BEFORE expiring anything, so its 4xx
			// answers (here an expired nonce) leave the old batch valid.
			if (body?.regenerate === true) {
				return Response.json(
					{
						code: 50035,
						message: "Invalid Form Body",
						errors: {
							nonce: {_errors: [{code: "INVALID_NONCE", message: "Invalid or expired nonce"}]},
						},
					},
					{status: 400},
				);
			}
			return Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		const regen = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === I18n.backupCodes.regenerate(),
		)!;
		regen.click();
		await vi.waitFor(() => expect(verifySent).toHaveLength(2));
		// The finally re-enables Regenerate: the handler has run to its end.
		await vi.waitFor(() => expect(regen.disabled).toBe(false));
		expect(gridCodes()).toEqual(["0ldC0de1"]);
		expect(document.querySelector(".backupCodeGrid")?.closest(".removeElm")).toBeNull();
		expect(verifySent).toHaveLength(2);
	});

	it("the server's rate-limit 429 keeps the shown codes and never re-reads: the limiter runs before the route", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			// The server's limiter body (middlewares/RateLimit.ts): no `code`, a numeric retry_after.
			if (body?.regenerate === true) {
				return Response.json(
					{message: "You are being rate limited.", retry_after: 3, global: false},
					{status: 429},
				);
			}
			return Response.json({backup_codes: [{code: "0ldC0de1", consumed: false}]});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		const regen = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === I18n.backupCodes.regenerate(),
		)!;
		regen.click();
		await vi.waitFor(() => expect(verifySent).toHaveLength(2));
		await vi.waitFor(() => expect(regen.disabled).toBe(false));
		expect(verifySent, "a rate-limited regenerate must not re-read").toHaveLength(2);
		expect(gridCodes()).toEqual(["0ldC0de1"]);
		expect(document.querySelector(".backupCodeGrid")?.closest(".removeElm")).toBeNull();
	});

	it("a 2xx regenerate answer with no usable code refuses and re-reads instead of closing in silence", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			// An object with the right key but nothing usable in it: the old batch is
			// already expired server-side, so the grid must not just vanish unexplained.
			if (body?.regenerate === true) {
				return Response.json({backup_codes: [{code: "", consumed: false}]});
			}
			viewCalls++;
			return Response.json({
				backup_codes: [{code: viewCalls === 1 ? "0ldC0de1" : "nEwC0de1", consumed: false}],
			});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body")),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
		expect(verifySent).toEqual([
			{key: "hunter22", nonce: "n-view", regenerate: false},
			{key: "hunter22", nonce: "n-regen", regenerate: true},
			{key: "hunter22", nonce: "n-view", regenerate: false},
		]);
	});

	it("a 408 non-JSON answer on the regenerate leg refuses, re-reads with the view nonce, and shows the re-read's codes", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			if (body?.regenerate === true) {
				return new Response("Request Timeout", {status: 408});
			}
			viewCalls++;
			return Response.json({
				backup_codes: [{code: viewCalls === 1 ? "0ldC0de1" : "nEwC0de1", consumed: false}],
			});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 408")),
		);
		await vi.waitFor(() =>
			expect(verifySent).toEqual([
				{key: "hunter22", nonce: "n-view", regenerate: false},
				{key: "hunter22", nonce: "n-regen", regenerate: true},
				{key: "hunter22", nonce: "n-view", regenerate: false},
			]),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
	});

	it("a network rejection on the regenerate leg re-reads with the view nonce and shows the re-read's codes", async () => {
		await openSecurityGrid();
		const {subForms} = capturePrompts();
		clickButton(I18n.localuser.viewBackupCodes());
		captureRequests(CHALLENGE_URL, () =>
			Response.json({nonce: "n-view", regenerate_nonce: "n-regen"}),
		);
		let viewCalls = 0;
		const {bodies: verifySent} = captureWithHeaders(VERIFY_URL, (req) => {
			const body = req.body as {regenerate?: boolean} | undefined;
			if (body?.regenerate === true) {
				throw new TypeError("Failed to fetch");
			}
			viewCalls++;
			return Response.json({
				backup_codes: [{code: viewCalls === 1 ? "0ldC0de1" : "nEwC0de1", consumed: false}],
			});
		});

		const form = subForms.at(-1)!;
		form.names.get("password")!.value = "hunter22";
		await form.submit();
		await vi.waitFor(() => expect(gridCodes()).toEqual(["0ldC0de1"]));

		clickButton(I18n.backupCodes.regenerate());
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("offline")),
		);
		await vi.waitFor(() =>
			expect(verifySent).toEqual([
				{key: "hunter22", nonce: "n-view", regenerate: false},
				{key: "hunter22", nonce: "n-regen", regenerate: true},
				{key: "hunter22", nonce: "n-view", regenerate: false},
			]),
		);
		await vi.waitFor(() => expect(gridCodes()).toEqual(["nEwC0de1"]));
	});
});
