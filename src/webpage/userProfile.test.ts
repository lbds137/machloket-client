import {afterEach, expect, it, onTestFinished, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Settings} = await import("./settings");
const {User} = await import("./user");
const {Member} = await import("./member");
const {I18n} = await import("./i18n");
await I18n.done;

const initialLang = I18n.lang;

afterEach(() => {
	I18n.lang = initialLang;
	vi.restoreAllMocks();
});

type Input = {onchange: (value: string) => void; submit(): void};

/**
 * Opens the user's own profile editor and hands back its pronouns box, colour picker and the
 * options the picker opened with. Only the profile tab is under test: the rest of the settings
 * may fail on this stub user, after the profile tab is built.
 */
async function openProfile(user: Record<string, unknown>) {
	const options = Object.getPrototypeOf(new Settings("").addButton("probe"));
	const text = vi.spyOn(options, "addTextInput");
	const color = vi.spyOn(options, "addColorInput");
	const saved: object[] = [];
	const localuser = Object.create(Localuser.prototype);
	// The preview copy of the user the editor draws as fields change.
	const hypo = {pronouns: "", bio: "", buildprofile: async () => document.createElement("div")};
	Object.assign(localuser, {
		user: {pronouns: "", bio: {rawString: ""}, getpfpsrc: () => "", clone: () => hypo, ...user},
		userinfo: {localuserStore: {user: {}}},
		updateProfile: (json: object) => saved.push(json),
	});
	await localuser.showusersettings().catch(() => {});
	const pronouns = text.mock.results[0].value as Input;
	const colorIdx = color.mock.calls.findIndex((c) => c[0] === I18n.profileColor());
	const picker = color.mock.results[colorIdx].value as Input;
	return {saved, pronouns, picker, pickerOpened: color.mock.calls[colorIdx]};
}

it("saving the profile without touching the colour sends no colour", async () => {
	const {saved, pronouns} = await openProfile({});

	pronouns.onchange("she/her");
	pronouns.submit();

	expect(saved).toHaveLength(1);
	expect(saved[0]).not.toHaveProperty("accent_color");
});

it("saving with nothing edited sends nothing", async () => {
	const {saved, pronouns} = await openProfile({});

	pronouns.submit();

	expect(saved).toEqual([]);
});

it("a picked colour is saved as its number (the control)", async () => {
	const {saved, pronouns, picker} = await openProfile({});

	picker.onchange("#00ff00");
	pronouns.submit();

	expect(saved).toEqual([expect.objectContaining({accent_color: 0x00ff00})]);
});

it("a dark accent colour opens as a full colour in the picker", async () => {
	const {pickerOpened} = await openProfile({accent_color: 0x0000ff});

	expect(pickerOpened[2]).toEqual({initColor: "#0000ff"});
});

it("a dark folder colour opens as a full colour in the folder's picker", async () => {
	const {Contextmenu} = await import("./contextmenu");
	const added = vi.spyOn(Contextmenu.prototype, "addButton");
	const color = vi.spyOn(
		Object.getPrototypeOf(new Settings("").addButton("probe")),
		"addColorInput",
	);
	const localuser = Object.create(Localuser.prototype);
	// Folder open states live in the account's stored info; dragging needs the sidebar.
	Object.defineProperty(localuser, "perminfo", {value: {}});
	localuser.makeGuildDragable = () => {};
	localuser.makeFolder({color: 0x0000ff, id: 1, name: "f", guilds: []});

	// The folder's "edit" menu entry opens the dialog holding the picker.
	(added.mock.calls[0][1] as () => void)();

	expect(color.mock.calls[0][2]).toEqual({initColor: "#0000ff"});
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

it("a full profile formats account creation and server join dates with I18n.locale", async () => {
	vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
	I18n.lang = "en";
	vi.spyOn(User.prototype, "highInfo").mockResolvedValue({
		mutual_guilds: [],
		connected_accounts: [],
	} as never);
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {
			api: "http://profile.test/api/v9",
			cdn: "http://profile.test",
			wellknown: "http://profile.test",
		},
		headers: {},
		user: {id: "me"},
		userMap: new Map(),
		guilds: [],
	});
	const user = new User(
		{
			id: "1553128655016763450",
			username: "alice",
			discriminator: "0001",
			avatar: null,
			bot: false,
			public_flags: 0,
			badge_ids: [],
			accent_color: 0,
			bio: "",
			premium_type: 0,
			premium_since: "",
			theme_colors: null,
		},
		localuser,
		true,
	);
	const member = Object.assign(Object.create(Member.prototype), {
		id: user.id,
		user,
		owner: {id: "g1", roles: [], properties: {name: "Wonderland"}, localuser},
		roleIds: new Set<string>(),
		joined_at: "2026-10-04T00:00:00Z",
		subName: () => {},
		hasPermission: () => false,
	});

	const profile = await user.fullProfile(member);
	await vi.waitFor(() => expect(profile.querySelector(".settingsHTMLArea p")).not.toBeNull());
	const joinedP = profile.querySelector(".settingsHTMLArea p")!;

	expect(joinedP.parentElement?.childNodes[0]?.textContent).toBe(
		I18n.profile.joined(new Date(user.getUnixTime()).toLocaleString("en-GB")),
	);
	expect(joinedP.textContent).toBe(
		I18n.profile.joinedMember(
			"Wonderland",
			new Date("2026-10-04T00:00:00Z").toLocaleString("en-GB"),
		),
	);
	profile.remove();
});

/**
 * A full profile whose /profile GET answers `respond`, with the mutual-guilds tab opened (the
 * tab's content mounts on click). highInfo is the real one here.
 */
async function openMutualGuilds(
	respond: () => Response | Promise<Response>,
	guildids: Map<string, unknown> = new Map(),
	beforeOpen?: (localuser: InstanceType<typeof Localuser>) => void,
) {
	captureRequests("http://profile.test/api/v9/users/1553128655016763450/profile", respond);
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {
			api: "http://profile.test/api/v9",
			cdn: "http://profile.test",
			wellknown: "http://profile.test",
		},
		headers: {},
		user: {id: "me"},
		// Decorations on, as Localuser defaults them (`decorations ??= true`), so buildpfp reads
		// avatar_decoration_data the way a real session does.
		userinfo: {localuserStore: {user: {decorations: true}}},
		userMap: new Map(),
		guilds: [],
		guildids,
	});
	beforeOpen?.(localuser);
	const user = new User(
		{
			id: "1553128655016763450",
			username: "alice",
			discriminator: "0001",
			avatar: null,
			bot: false,
			public_flags: 0,
			badge_ids: [],
			accent_color: 0,
			bio: "",
			premium_type: 0,
			premium_since: "",
			theme_colors: null,
		},
		localuser,
		true,
	);
	const member = Object.assign(Object.create(Member.prototype), {
		id: user.id,
		user,
		owner: {id: "g1", roles: [], properties: {name: "Wonderland"}, localuser},
		roleIds: new Set<string>(),
		joined_at: "2026-10-04T00:00:00Z",
		subName: () => {},
		hasPermission: () => false,
	});

	const profile = await user.fullProfile(member);
	onTestFinished(() => profile.remove());
	const tab = await vi.waitFor(() => {
		const button = [...profile.querySelectorAll("button")].find(
			(b) => b.textContent === I18n.profile.mut(),
		);
		expect(button).not.toBeUndefined();
		return button!;
	});
	tab.click();
	return profile;
}

/** Clicks the open profile's tab labelled `label`; fails the test if there is none. */
function clickTab(profile: HTMLElement, label: string) {
	const tab = [...profile.querySelectorAll("button")].find((b) => b.textContent === label);
	expect(tab, `no "${label}" tab`).not.toBeUndefined();
	tab!.click();
}

it("an accepted profile GET opens the mutual-guilds tab without a note (the control)", async () => {
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() => Response.json({mutual_guilds: [{id: "g1"}], connected_accounts: []}),
		guildids,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	expect(profile.textContent).not.toContain(I18n.requestFailed("HTTP 200"));
});

it("a refused profile GET puts the reason where the mutual guilds would sit", async () => {
	const profile = await openMutualGuilds(() => Response.json({message: "boom"}, {status: 403}));

	await vi.waitFor(() => expect(profile.textContent).toContain(I18n.requestFailed("boom")));
});

it("a profile GET that never arrived says the network failed where the mutual guilds would sit", async () => {
	const profile = await openMutualGuilds(() => Promise.reject(new TypeError("offline")));

	await vi.waitFor(() => expect(profile.textContent).toContain(I18n.requestFailed("offline")));
});

it("a profile answer that isn't JSON says why where the mutual guilds would sit", async () => {
	const profile = await openMutualGuilds(() => new Response("<html>"));

	// Not JSON, so refusalText gives the status.
	await vi.waitFor(() => expect(profile.textContent).toContain(I18n.requestFailed("HTTP 200")));
});

it("a profile answer without a mutual-guilds list says why instead of throwing", async () => {
	const unhandled = vi.fn();
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	const profile = await openMutualGuilds(() => Response.json({message: "hidden"}));

	// Cloning before json() leaves the body for refusalText to read the server's message.
	await vi.waitFor(() => expect(profile.textContent).toContain(I18n.requestFailed("hidden")));
	expect(unhandled).not.toHaveBeenCalled();
});

it("a connected-account type matching only an inherited key draws no profile row", async () => {
	const unhandled = vi.fn((e: PromiseRejectionEvent) => e.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	captureRequests("http://profile.test/api/v9/connections", () =>
		Response.json({github: {enabled: true}, 42: {enabled: true}}),
	);
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				connected_accounts: [
					// Hostile shape classes the draw must skip without dropping the rows
					// after them: a bare null element (reading .type of it used to throw
					// and kill the uncaught IIFE), a non-string type whose ToPropertyKey
					// ("42") is an own key of the connections map, the inherited-key class
					// ("toString" with no such own key), and — the positive control — a
					// well-formed github entry that must still draw.
					null,
					{type: 42, name: "evil", external_id: "1"},
					{type: "toString", name: "sneak", external_id: "3"},
					{type: "github", name: "octocat", external_id: "2"},
				],
			}),
		guildids,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	// The connections rows mount in the User info pane, not the mutual-guilds one.
	clickTab(profile, I18n.profile.userInfo());
	await vi.waitFor(() => expect(profile.textContent).toContain(I18n.profile.bio()));
	// The rows draw once the connections fetch resolves; wait for the first row
	// instead of trusting ticks to cover that chain, then pin "exactly one" —
	// the trailing ticks still catch a hostile row drawing late.
	await vi.waitFor(() =>
		expect(profile.querySelectorAll(".conProfDiv").length).toBeGreaterThan(0),
	);
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	const rows = profile.querySelectorAll(".conProfDiv");
	expect(rows).toHaveLength(1);
	expect(rows[0]?.textContent).toContain("octocat");
	expect(unhandled).not.toHaveBeenCalled();
});

it("a profile answer without a connected-accounts list renders the mutual guilds", async () => {
	const unhandled = vi.fn();
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() => Response.json({mutual_guilds: [{id: "g1"}]}),
		guildids,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	expect(profile.textContent).not.toContain(I18n.requestFailed("HTTP 200"));
	expect(unhandled).not.toHaveBeenCalled();
});

it("a profile answer with a non-array mutual-friends field still renders the mutual guilds", async () => {
	const unhandled = vi.fn((e: PromiseRejectionEvent) => e.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				mutual_friends: "x",
				connected_accounts: [],
			}),
		guildids,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	expect(unhandled).not.toHaveBeenCalled();
});

it("a refused /connections GET while opening a profile stays quiet and renders mutual guilds", async () => {
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	const connections = captureRequests("http://profile.test/api/v9/connections", () =>
		Response.json({message: "boom"}, {status: 500}),
	);
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				connected_accounts: [{type: "github", name: "x", external_id: "1"}],
			}),
		guildids,
	);

	await vi.waitFor(() => expect(connections).toHaveLength(1));
	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	expect(document.body.textContent).not.toContain(I18n.requestFailed("boom"));
});

const bob = {
	id: "1553128655016763451",
	username: "bob",
	discriminator: "0002",
	avatar: null,
	bot: false,
	public_flags: 0,
	badge_ids: [],
	accent_color: 0,
	bio: "",
	premium_type: 0,
	premium_since: "",
	theme_colors: null,
};

const friendGuildIds = new Map<string, unknown>([
	["@me", {id: "@me"}],
	[
		"g1",
		{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
	],
]);

it("a null mutual-friends entry is skipped so the valid friend and connection row still draw", async () => {
	const unhandled = vi.fn((e: PromiseRejectionEvent) => e.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	captureRequests("http://profile.test/api/v9/connections", () =>
		Response.json({github: {enabled: true}}),
	);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				mutual_friends: [null, bob],
				connected_accounts: [{type: "github", name: "octocat", external_id: "2"}],
			}),
		friendGuildIds,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	clickTab(profile, I18n.profile.mutFriends());
	const widgets = [...profile.querySelectorAll(".mutFriends .createdWebhook b")].map(
		(b) => b.textContent,
	);
	clickTab(profile, I18n.profile.userInfo());
	// The connections draw after their own fetch: wait for a row, not for ticks.
	await vi.waitFor(() =>
		expect(profile.querySelectorAll(".conProfDiv").length).toBeGreaterThan(0),
	);
	const rows = [...profile.querySelectorAll(".conProfDiv span")].map((s) => s.textContent);
	expect({widgets, rows}).toEqual({widgets: ["bob"], rows: ["octocat"]});
	expect(unhandled).not.toHaveBeenCalled();
});

it("a mutual friend whose widget can't be built is skipped; the valid friend and connection row still draw", async () => {
	const unhandled = vi.fn((e: PromiseRejectionEvent) => e.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	captureRequests("http://profile.test/api/v9/connections", () =>
		Response.json({github: {enabled: true}}),
	);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				// A string id that isn't a snowflake: the default-avatar path's BigInt throws
				// while the widget is built, which must skip this friend, not the whole profile.
				mutual_friends: [{...bob, id: "x", username: "mallory"}, bob],
				connected_accounts: [{type: "github", name: "octocat", external_id: "2"}],
			}),
		friendGuildIds,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	clickTab(profile, I18n.profile.mutFriends());
	const widgets = [...profile.querySelectorAll(".mutFriends .createdWebhook b")].map(
		(b) => b.textContent,
	);
	clickTab(profile, I18n.profile.userInfo());
	await vi.waitFor(() =>
		expect(profile.querySelectorAll(".conProfDiv").length).toBeGreaterThan(0),
	);
	const rows = [...profile.querySelectorAll(".conProfDiv span")].map((s) => s.textContent);
	expect({widgets, rows}).toEqual({widgets: ["bob"], rows: ["octocat"]});
	expect(unhandled).not.toHaveBeenCalled();
});

it("a mutual friend that throws while drawing leaves no new userMap entry, while a pre-existing cached user stays", async () => {
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	let localuser!: InstanceType<typeof Localuser>;
	let cached!: InstanceType<typeof User>;
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				mutual_friends: [
					{...bob, id: "x", username: "mallory"},
					{
						...bob,
						id: cached.id,
						username: "carol",
						// Throws in buildpfp (asset.startsWith) after checkuser updates the
						// already-cached user in place. Needs the fixture's decorations on:
						// buildpfp reads the asset only then.
						avatar_decoration_data: {asset: 1 as unknown as string, sku_id: "s"},
					},
					bob,
				],
				connected_accounts: [],
			}),
		friendGuildIds,
		(lu) => {
			localuser = lu;
			cached = new User({...bob, id: "1553128655016763452", username: "carol"}, lu);
		},
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	clickTab(profile, I18n.profile.mutFriends());
	const widgets = [...profile.querySelectorAll(".mutFriends .createdWebhook b")].map(
		(b) => b.textContent,
	);
	expect(widgets).toEqual(["bob"]);
	expect(localuser.userMap.has("x")).toBe(false);
	expect(localuser.userMap.get(cached.id)).toBe(cached);
});

it("a throwing mutual friend whose payload carries its own uid is still evicted under the key the cache used", async () => {
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	let localuser!: InstanceType<typeof Localuser>;
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [{id: "g1"}],
				// A non-snowflake id throws in the default avatar; the wire `uid` is not the cache key.
				mutual_friends: [{...bob, id: "y", uid: "other", username: "eve"}, bob],
				connected_accounts: [],
			}),
		friendGuildIds,
		(lu) => {
			localuser = lu;
		},
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	clickTab(profile, I18n.profile.mutFriends());
	const widgets = [...profile.querySelectorAll(".mutFriends .createdWebhook b")].map(
		(b) => b.textContent,
	);
	expect(widgets).toEqual(["bob"]);
	expect(localuser.userMap.has("y"), "the thrower stayed cached").toBe(false);
});

it("a null mutual-guilds entry is skipped so the known guild and connection row still draw", async () => {
	const unhandled = vi.fn((e: PromiseRejectionEvent) => e.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));
	onTestFinished(() =>
		document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove()),
	);
	captureRequests("http://profile.test/api/v9/connections", () =>
		Response.json({github: {enabled: true}}),
	);
	const guildids = new Map([
		[
			"g1",
			{generateGuildIcon: () => document.createElement("img"), properties: {name: "Wonderland"}},
		],
	]);
	const profile = await openMutualGuilds(
		() =>
			Response.json({
				mutual_guilds: [null, {id: "g1"}],
				connected_accounts: [{type: "github", name: "octocat", external_id: "2"}],
			}),
		guildids,
	);

	await vi.waitFor(() => expect(profile.querySelector(".mutGuildBox")).not.toBeNull());
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	const guilds = [...profile.querySelectorAll(".mutGuildBox")].map((g) => g.textContent);
	clickTab(profile, I18n.profile.userInfo());
	// The connections draw after their own fetch: wait for a row, not for ticks.
	await vi.waitFor(() =>
		expect(profile.querySelectorAll(".conProfDiv").length).toBeGreaterThan(0),
	);
	const rows = [...profile.querySelectorAll(".conProfDiv span")].map((s) => s.textContent);
	expect({guilds, rows}).toEqual({guilds: ["Wonderland"], rows: ["octocat"]});
	expect(unhandled).not.toHaveBeenCalled();
});
