import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Dialog, Options, Settings} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://settingsget.test/api/v9";
const refused = () => Response.json({message: "boom"}, {status: 500});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** A Localuser with only the fields the settings builders read. */
function settingsUser(rights: string[] = []) {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://settingsget.test"},
		headers: {Authorization: "t"},
		// The account's own user, as the profile editor reads it (see userProfile.test.ts).
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
		rights: {allow: 0, hasPermission: (perm: string) => rights.includes(perm)},
		inrelation: new Set(),
		channelids: new Map(),
		// perminfo walks userinfo.localuserStore; its .user holds the account's own switches.
		userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
		userMap: new Map(),
		guilds: [],
		trace: [],
	}) as unknown as InstanceType<typeof Localuser>;
}

function guild(memberPerms: string[] = []) {
	const g = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels: [],
		headchannels: [],
		properties: {name: "G", features: []},
		member: {hasPermission: (perm: string) => memberPerms.includes(perm)},
		owner: settingsUser(),
	}) as unknown as InstanceType<typeof Guild>;
	// The real constructor seeds this; Channel's constructor reads it.
	g.perminfo = {channels: {}};
	return g;
}

/** An owner account, as manageApplication/manageBot read it (see ownerCode.test.ts). */
function appUser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		mfa_enabled: true,
		userinfo: {localuserStore: {applications: {}}},
		botTokens: new Map(),
		userMap: new Map(),
		guilds: [],
	}) as InstanceType<typeof Localuser>;
}

/** Stubs every build-time GET of showusersettings except the one under test. */
function stubUserSettings() {
	captureRequests(API + "/users/@me/connections", () => Response.json([]));
	captureRequests(API + "/connections", () => Response.json({github: {enabled: true}}));
	captureRequests(API + "/teams", () => Response.json([]));
	captureRequests(API + "/applications", () => Response.json([]));
	captureRequests(API + "/policies/instance/", () => Response.json({instanceName: "T"}));
	// The sessions section is fetched during the build; unstubbed, fetchSessions hands the
	// builder its refusal string and the pane dies half-built (see sessionList.test.ts).
	captureRequests(API + "/auth/sessions", () => Response.json({user_sessions: []}));
}

/** Records each settings button's callback by label, keeping the real button working. */
function captureButtons() {
	const buttons = new Map<string, () => void>();
	const real = Options.prototype.addButtonInput;
	vi.spyOn(Options.prototype, "addButtonInput").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: [string, string, () => void]
	) {
		buttons.set(args[1], args[2]);
		return real.apply(this, args);
	});
	return buttons;
}

/** Opens the user settings and mounts the connections section (sections mount on click). */
async function openConnections() {
	const u = settingsUser();
	await u.showusersettings().catch(() => {});
	const tab = [...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")].find(
		(b) => b.textContent === I18n.localuser.connections(),
	);
	expect(tab).not.toBeUndefined();
	tab!.click();
	return u;
}

/** Opens the connections section and returns its first row, with window.open spied. */
async function connectionRow() {
	await openConnections();
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	const row = await vi.waitFor(() => {
		const el = document.querySelector<HTMLElement>(".connection-container > div");
		expect(el).not.toBeNull();
		return el;
	});
	return {open, row: row!};
}

it("a refused welcome-screen GET in showWelcome says why and opens no welcome dialog", async () => {
	captureRequests(API + "/guilds/g1/welcome-screen", refused);
	const g = guild();

	await g.showWelcome().catch(() => {});

	expect(g.welcomeScreen).toBeUndefined();
	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(document.body.textContent).not.toContain(I18n.onboarding.title("G"));
});

it("a refused welcome-screen GET in guild settings says why and keeps the onboarding section", async () => {
	captureRequests(API + "/guilds/g1/welcome-screen", refused);
	captureRequests(API + "/guilds/g1/invites", () => Response.json([]));
	captureRequests(API + "/guilds/g1/widget", () =>
		Response.json({enabled: false, channel_id: null}),
	);
	captureRequests(API + "/guilds/g1/templates", () => Response.json([]));
	const g = guild(["MANAGE_GUILD"]);
	let onboard: InstanceType<typeof Options> | undefined;
	const realAddButton = Settings.prototype.addButton;
	vi.spyOn(Settings.prototype, "addButton").mockImplementation(function (
		this: InstanceType<typeof Settings>,
		...args: Parameters<typeof realAddButton>
	) {
		const options = realAddButton.apply(this, args);
		if (args[0] === I18n.onboarding.name()) onboard = options;
		return options;
	});

	g.generateSettings();
	// genOnboard() runs during the build but its fetch settles after it returns.
	const removeAll = vi.spyOn(onboard!, "removeAll");
	await new Promise((r) => setTimeout(r, 50));

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(g.welcomeScreen).toBeUndefined();
	expect(removeAll).not.toHaveBeenCalled();
});

it("a refused connections GET says why and still lists the instance's connection types", async () => {
	stubUserSettings();
	captureRequests(API + "/users/@me/connections", refused);
	await openConnections();
	await new Promise((r) => setTimeout(r, 50));

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(document.querySelector(".connection-container")?.children.length).toBe(1);
});

it("a refused connection authorize click says why and opens no window", async () => {
	stubUserSettings();
	captureRequests(API + "/connections/github/authorize", refused);
	const {open, row} = await connectionRow();

	row.click();
	await new Promise((r) => setTimeout(r, 50));

	expect(open).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
});

it("an offline connection authorize click says the network failed and opens no window", async () => {
	stubUserSettings();
	captureRequests(API + "/connections/github/authorize", () =>
		Promise.reject(new TypeError("offline")),
	);
	const {open, row} = await connectionRow();

	row.click();
	await new Promise((r) => setTimeout(r, 50));

	expect(open).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("an accepted connection authorize click opens the external authorize URL", async () => {
	stubUserSettings();
	captureRequests(API + "/connections/github/authorize", () =>
		Response.json({url: "https://x.test/a"}),
	);
	const {open, row} = await connectionRow();

	row.click();
	await new Promise((r) => setTimeout(r, 50));

	expect(open).toHaveBeenCalledTimes(1);
	expect(open).toHaveBeenCalledWith("https://x.test/a", "_blank", "noopener noreferrer");
});

it("a refused registration-token creation says why and leaves the output empty", async () => {
	const buttons = captureButtons();
	// The output pre mounts with the instance-management suboptions, not the document:
	// catch it where the pane hands it over.
	const pres: HTMLPreElement[] = [];
	const realArea = Options.prototype.addHTMLArea;
	vi.spyOn(Options.prototype, "addHTMLArea").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: [HTMLElement | (() => HTMLElement), ...unknown[]]
	) {
		if (args[0] instanceof HTMLPreElement) pres.push(args[0]);
		return realArea.apply(this, args as never);
	});
	stubUserSettings();
	// captureRequests keys origin+pathname only - the query string never matches.
	captureRequests(API + "/auth/generate-registration-tokens", refused);
	const u = settingsUser(["CREATE_REGISTRATION_TOKENS"]);

	await u.showusersettings().catch(() => {});
	buttons.get(I18n.manageInstance.createTokens())!();
	const create = buttons.get(I18n.manageInstance.create())!;
	await Promise.resolve(create()).catch(() => {});

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(pres.map((p) => p.textContent)).toEqual([""]);
});

it("a refused instance-policy GET says why", async () => {
	stubUserSettings();
	captureRequests(API + "/policies/instance/", refused);
	const u = settingsUser();

	await u.showusersettings().catch(() => {});
	await new Promise((r) => setTimeout(r, 50));

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
});

it("an instance-policy GET that never arrived says the network failed", async () => {
	stubUserSettings();
	captureRequests(API + "/policies/instance/", () => Promise.reject(new TypeError("offline")));
	const u = settingsUser();

	await u.showusersettings().catch(() => {});
	await new Promise((r) => setTimeout(r, 50));

	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("an instance-connection-types GET that never arrived says why and still mounts the pane", async () => {
	stubUserSettings();
	captureRequests(API + "/connections", () => Promise.reject(new TypeError("offline")));
	await openConnections();
	await new Promise((r) => setTimeout(r, 50));

	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
	expect(document.querySelector(".connection-container")).not.toBeNull();
});

it("a registration-token answer that isn't JSON says why and leaves the output empty", async () => {
	const buttons = captureButtons();
	const pres: HTMLPreElement[] = [];
	const realArea = Options.prototype.addHTMLArea;
	vi.spyOn(Options.prototype, "addHTMLArea").mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: [HTMLElement | (() => HTMLElement), ...unknown[]]
	) {
		if (args[0] instanceof HTMLPreElement) pres.push(args[0]);
		return realArea.apply(this, args as never);
	});
	stubUserSettings();
	captureRequests(API + "/auth/generate-registration-tokens", () => new Response("<html>"));
	const u = settingsUser(["CREATE_REGISTRATION_TOKENS"]);

	await u.showusersettings().catch(() => {});
	buttons.get(I18n.manageInstance.createTokens())!();
	const create = buttons.get(I18n.manageInstance.create())!;
	await Promise.resolve(create()).catch(() => {});

	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200"));
	expect(pres.map((p) => p.textContent)).toEqual([""]);
});

it("a bot-manager answer that isn't JSON says why and alerts nothing", async () => {
	captureRequests(API + "/applications/a1", () => new Response("<html>"));
	const alerted = vi.spyOn(window, "alert").mockImplementation(() => {});
	const u = appUser();

	await u.manageBot("a1", new Dialog("").options as never).catch(() => {});

	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200"));
	expect(alerted).not.toHaveBeenCalled();
});

it("a refused application GET says why and builds no application form", async () => {
	captureRequests(API + "/applications/a1", refused);
	const addSubForm = vi.spyOn(Options.prototype, "addSubForm");
	const u = appUser();

	await u.manageApplication("a1", new Dialog("").options, () => {}).catch(() => {});

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(addSubForm).not.toHaveBeenCalled();
});

it("a refused application GET in the bot manager says why and alerts nothing", async () => {
	captureRequests(API + "/applications/a1", refused);
	const alerted = vi.spyOn(window, "alert").mockImplementation(() => {});
	const addSubForm = vi.spyOn(Options.prototype, "addSubForm");
	const u = appUser();

	await u.manageBot("a1", new Dialog("").options as never).catch(() => {});

	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));
	expect(alerted).not.toHaveBeenCalled();
	expect(addSubForm).not.toHaveBeenCalled();
});

/** Opens the user settings, mounts the account-security tab and fires the passkey-list GET. */
async function openPasskeyList() {
	const u = settingsUser();
	await u.showusersettings().catch(() => {});
	[...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")]
		.find((b) => b.textContent === I18n.localuser.accountSettings())!
		.click();
	const manage = await vi.waitFor(() => {
		const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === I18n.webauth.manage(),
		);
		expect(b).not.toBeUndefined();
		return b;
	});
	manage!.click();
}

it("a refused passkey-list GET says why instead of an empty panel", async () => {
	stubUserSettings();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", refused);

	await openPasskeyList();

	await vi.waitFor(() => expect(document.body.textContent).toContain(I18n.requestFailed("boom")));
});

it("a passkey-list GET that never arrived says the network failed", async () => {
	stubUserSettings();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () =>
		Promise.reject(new TypeError("offline")),
	);

	await openPasskeyList();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("offline")),
	);
});

it("a passkey-list answer that isn't JSON says why", async () => {
	stubUserSettings();
	captureRequests(API + "/users/@me/mfa/webauthn/credentials", () => new Response("<html>"));

	await openPasskeyList();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200")),
	);
});

/** Opens the user settings and mounts the developer-portal section (sections mount on click). */
async function openDevPortal() {
	const u = settingsUser();
	await u.showusersettings().catch(() => {});
	const tab = [...document.querySelectorAll<HTMLButtonElement>(".SettingsButton")].find(
		(b) => b.textContent === I18n.localuser.devPortal(),
	);
	expect(tab).not.toBeUndefined();
	tab!.click();
}

it("a refused applications GET says so inside the panel instead of modal-spamming Settings", async () => {
	stubUserSettings();
	captureRequests(API + "/applications", refused);

	await openDevPortal();

	await vi.waitFor(() =>
		expect(document.querySelector("#app-list-container")!.textContent).toContain(
			I18n.requestFailed("boom"),
		),
	);
});

it("a refused teams GET degrades quietly: apps still list, Create App stays", async () => {
	stubUserSettings();
	captureRequests(API + "/teams", refused);
	captureRequests(API + "/applications", () =>
		Response.json([{id: "a1", name: "Listed App", bot: false, icon: null, cover_image: null}]),
	);

	await openDevPortal();

	await vi.waitFor(() =>
		expect(document.querySelector("#app-list-container")!.textContent).toContain("Listed App"),
	);
	// No dialog anywhere: the teams list only feeds one Create App <select>.
	expect(document.body.textContent).not.toContain(I18n.requestFailed("boom"));
	expect(
		[...document.querySelectorAll("button")].some(
			(b) => b.textContent === I18n.localuser.createApp(),
		),
	).toBe(true);
});

it("a teams GET that never arrived degrades the same way", async () => {
	stubUserSettings();
	captureRequests(API + "/teams", () => Promise.reject(new TypeError("offline")));
	captureRequests(API + "/applications", () =>
		Response.json([{id: "a1", name: "Listed App", bot: false, icon: null, cover_image: null}]),
	);

	await openDevPortal();

	await vi.waitFor(() =>
		expect(document.querySelector("#app-list-container")!.textContent).toContain("Listed App"),
	);
	expect(document.body.textContent).not.toContain(I18n.requestFailed("offline"));
});

it("a teams answer that isn't an array degrades the same way", async () => {
	stubUserSettings();
	captureRequests(API + "/teams", () => Response.json({error: "nope"}));
	captureRequests(API + "/applications", () =>
		Response.json([{id: "a1", name: "Listed App", bot: false, icon: null, cover_image: null}]),
	);

	await openDevPortal();

	await vi.waitFor(() =>
		expect(document.querySelector("#app-list-container")!.textContent).toContain("Listed App"),
	);
});

it("an applications answer that isn't an array says so inside the panel", async () => {
	stubUserSettings();
	captureRequests(API + "/applications", () => Response.json({error: "nope"}));

	await openDevPortal();

	await vi.waitFor(() =>
		expect(document.querySelector("#app-list-container")!.textContent).toContain(
			I18n.requestFailed("HTTP 200"),
		),
	);
});
