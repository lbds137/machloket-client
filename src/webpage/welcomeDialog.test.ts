import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";
import type {welcomeScreen} from "./jsontypes";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://welcomedialog.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** A Localuser with only the fields the welcome dialog reads (shape from settingsGetRefusals). */
function settingsUser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://welcomedialog.test"},
		headers: {Authorization: "t"},
		// Real Localusers hold `user` at render time; MarkDown's channel getter tests for it
		// ("user" in owner) and without it the welcome description's emoji tokens drop.
		user: {id: "me"},
		userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
		userMap: new Map(),
		guilds: [],
	}) as unknown as InstanceType<typeof Localuser>;
}

/** A Guild whose channels are plain {id, name} rows — getChannel just finds them. */
function guild(
	channels: {id: string; name: string}[],
	emojis: {id: string; animated: boolean}[] = [],
) {
	const g = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels,
		headchannels: [],
		emojis,
		properties: {name: "G"},
		member: {hasPermission: () => false},
		owner: settingsUser(),
	}) as unknown as InstanceType<typeof Guild>;
	// The real constructor seeds this; Channel's constructor reads it.
	g.perminfo = {channels: {}};
	return g;
}

function answerScreen(overrides: Partial<welcomeScreen> = {}) {
	const screen: welcomeScreen = {
		enabled: true,
		description: "Welcome to the **server**",
		welcome_channels: [
			{channel_id: "c1", description: "say hi", emoji_id: "e1", emoji_name: "wave"},
			{channel_id: "c2", description: "read the rules", emoji_name: "📜"},
			{channel_id: "c3", description: "hang out"},
		],
		...overrides,
	};
	captureRequests(API + "/guilds/g1/welcome-screen", () => Response.json(screen));
	return screen;
}

const CHANNELS = [{id: "c1", name: "general"}, {id: "c2", name: "rules"}, {id: "c3", name: "lounge"}];

it("the welcome dialog renders the screen description, per-channel emoji and rows", async () => {
	answerScreen();
	const g = guild(CHANNELS, [{id: "e1", animated: true}]);

	await g.showWelcome();

	expect(document.body.textContent).toContain(I18n.onboarding.title("G"));
	// The description renders as markdown (the settings editor authors it through an MD input).
	expect(document.body.textContent).toContain("Welcome to the server");
	expect(document.body.textContent).toContain("say hi");
	expect(document.body.textContent).toContain("read the rules");
	expect(document.body.textContent).toContain("📜");
	// emoji_id renders as the custom-emoji image; the guild's own list marks it animated.
	const img = document.querySelector<HTMLImageElement>("img.smallemoji");
	expect(img?.src).toContain("/emojis/e1.gif");
});

it("an emoji_id unknown to the guild falls back to a static image", async () => {
	answerScreen();
	const g = guild(CHANNELS, []);

	await g.showWelcome();

	const img = document.querySelector<HTMLImageElement>("img.smallemoji");
	expect(img?.src).toContain("/emojis/e1.png");
});

it("a welcome screen whose channels all went stale opens no dialog", async () => {
	answerScreen({welcome_channels: [{channel_id: "ghost", description: "gone"}]});
	const g = guild(CHANNELS);

	await g.showWelcome();

	expect(document.body.textContent).not.toContain(I18n.onboarding.title("G"));
});

it("a custom-emoji token in the description renders as the emoji image", async () => {
	answerScreen({description: "Picks <:party:123456789012345678> here"});
	const g = guild(CHANNELS);

	await g.showWelcome();

	const img = document.querySelector<HTMLImageElement>("img.smallemoji");
	expect(img).not.toBeNull();
	expect(img!.src).toContain("/emojis/123456789012345678");
});

it("a stale channel after the last valid one adds no trailing divider", async () => {
	answerScreen({
		welcome_channels: [
			{channel_id: "ghost", description: "gone"},
			{channel_id: "c1", description: "say hi"},
		],
	});
	const g = guild(CHANNELS);

	await g.showWelcome();

	expect(document.body.textContent).toContain(I18n.onboarding.title("G"));
	expect(document.body.textContent).toContain("say hi");
	expect(document.body.textContent).not.toContain("gone");
	// One resolvable row: rows are separated by hrs, so zero of them.
	expect(document.querySelectorAll("hr")).toHaveLength(0);
});

it("a disabled welcome screen opens nothing (control)", async () => {
	answerScreen({enabled: false});
	const g = guild(CHANNELS);

	await g.showWelcome();

	expect(document.body.textContent).not.toContain(I18n.onboarding.title("G"));
});

it("an empty description still renders the rows (control)", async () => {
	answerScreen({description: ""});
	const g = guild(CHANNELS);

	await g.showWelcome();

	expect(document.body.textContent).toContain(I18n.onboarding.title("G"));
	expect(document.body.textContent).toContain("say hi");
});
