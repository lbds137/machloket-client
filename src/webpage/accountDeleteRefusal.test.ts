import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Options} = await import("./settings");
const {I18n} = await import("./i18n");
const {NotificationSoundManager} = await import("./utils/notificationSound");
await I18n.done;

const API = "http://delacct.test/api/v9";
const MESSAGE = "User owns teams and cannot be deleted";

type SubForm = {
	names: Map<string, {value: unknown}>;
	submit(): Promise<void>;
};

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	document.body.className = "";
	localStorage.clear();
});

/** A Localuser with only the fields the settings builders read (see settingsPrefsWrites.test.ts). */
function settingsUser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://delacct.test"},
		headers: {Authorization: "t"},
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

/** Stubs every build-time GET of showusersettings. */
function stubUserSettings() {
	captureRequests(API + "/users/@me/connections", () => Response.json([]));
	captureRequests(API + "/connections", () => Response.json({github: {enabled: true}}));
	captureRequests(API + "/teams", () => Response.json([]));
	captureRequests(API + "/applications", () => Response.json([]));
	captureRequests(API + "/policies/instance/", () => Response.json({instanceName: "T"}));
	captureRequests(API + "/auth/sessions", () => Response.json({user_sessions: []}));
}

/**
 * Opens the settings page and returns the account-delete form, keeping real forms working.
 * Any MFA prompt form opened later is recorded instead of shown silently.
 */
async function deleteForm() {
	stubUserSettings();
	vi.spyOn(NotificationSoundManager, "playFromPreferences").mockResolvedValue();
	const realAddForm = Options.prototype.addForm;
	let form: SubForm | undefined;
	const mfaPromptForms: unknown[] = [];
	vi.spyOn(Options.prototype, "addForm").mockImplementation(function (
		this: unknown,
		...args: Parameters<typeof realAddForm>
	) {
		const made = realAddForm.apply(this, args) as unknown as SubForm;
		if (String(args[2]?.fetchURL ?? "").endsWith("/users/@me/delete/")) form = made;
		if (String(args[2]?.fetchURL ?? "").includes("/users/@me/mfa/")) mfaPromptForms.push(made);
		return made as never;
	});
	await settingsUser().showusersettings();
	expect(form, "the account-delete form was built").toBeDefined();
	// The delete form lives in the "Your account" section, which mounts on its click (the
	// inputs' error wrappers only exist once mounted — handleError needs them).
	const yourAccount = I18n.getTranslation("settingsCategories.user.yourAccount");
	const tab = [...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")].find(
		(b) => b.textContent === yourAccount,
	);
	expect(tab, "the Your account section button was built").toBeDefined();
	tab!.click();
	return {form: form!, mfaPromptForms};
}

// The server answers this 403 BEFORE any MFA challenge: the message reaches the form's
// password field, and no second-factor step precedes it.
it("a owns-guilds 403 on account delete shows the server's message on the password field", async () => {
	const sent = captureRequests(API + "/users/@me/delete/", () =>
		Response.json({message: MESSAGE}, {status: 403}),
	);
	const totpSent = captureRequests(API + "/users/@me/mfa/totp", () =>
		Response.json({token: "unexpected"}),
	);
	const {form, mfaPromptForms} = await deleteForm();
	form.names.get("shrek")!.value = I18n.localuser.sillyDeleteConfirmPhrase();
	form.names.get("password")!.value = "hunter2";
	const hrefBefore = window.location.href;

	await form.submit();

	expect(sent).toEqual([{password: "hunter2"}]);
	expect(mfaPromptForms).toHaveLength(0);
	expect(totpSent).toEqual([]);
	const suberrors = [...document.querySelectorAll<HTMLElement>(".suberror")].map(
		(el) => el.textContent,
	);
	expect(suberrors).toContain(MESSAGE);
	// Still on the page: a success would have navigated to "/" instead.
	expect(window.location.href).toBe(hrefBefore);
});
