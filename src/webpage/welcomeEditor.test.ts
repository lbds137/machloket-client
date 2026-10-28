import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Emoji} = await import("./emoji");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://welcomeeditor.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

type welcomeEntry = {
	channel_id: string;
	description: string;
	emoji_id?: string;
	emoji_name?: string;
};

const SCREEN = {
	enabled: true,
	description: "d",
	welcome_channels: [
		{channel_id: "c1", description: "say hi", emoji_id: "111", emoji_name: "wave"},
		{channel_id: "c2", description: "rules", emoji_name: "📜"},
	] as welcomeEntry[],
};

/** The emoji the fake picker hands back when a slot is clicked. */
let picked: InstanceType<typeof Emoji> | null = null;

function settingsUser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://welcomeeditor.test"},
		headers: {Authorization: "t"},
		rights: {allow: 0, hasPermission: () => false},
		inrelation: new Set(),
		channelids: new Map(),
		user: {id: "me"},
		userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
		userMap: new Map(),
		guilds: [],
		trace: [],
		emojiPicker: async () => picked,
	}) as unknown as InstanceType<typeof Localuser>;
}

function guild() {
	const g = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels: [
			{id: "c1", name: "general", type: 0, isThread: () => false},
			{id: "c2", name: "rules", type: 0, isThread: () => false},
			{id: "c3", name: "lounge", type: 0, isThread: () => false},
		],
		headchannels: [],
		emojis: [{id: "111", animated: false}],
		properties: {name: "G", features: []},
		member: {hasPermission: (perm: string) => perm === "MANAGE_GUILD"},
		owner: settingsUser(),
	}) as unknown as InstanceType<typeof Guild>;
	g.perminfo = {channels: {}};
	return g;
}

/** Opens guild settings, mounts the onboarding section (sections mount on their rail
 * button's click) and captures the welcome-screen endpoint. */
function openOnboard(respond: () => Response = () => Response.json(SCREEN)) {
	const bodies = captureRequests(API + "/guilds/g1/welcome-screen", respond);
	captureRequests(API + "/guilds/g1/invites", () => Response.json([]));
	captureRequests(API + "/guilds/g1/widget", () =>
		Response.json({enabled: false, channel_id: null}),
	);
	captureRequests(API + "/guilds/g1/templates", () => Response.json([]));
	const g = guild();
	g.generateSettings();
	const rail = [...document.querySelectorAll("button")].find(
		(b) => b.textContent === I18n.onboarding.name(),
	);
	expect(rail, "the onboarding section button renders").not.toBeUndefined();
	rail!.click();
	return {bodies, g};
}

/** Clicks the button whose label is `text` anywhere in the pane. */
function clickButton(text: string) {
	const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
	expect(button, `button ${text} renders`).not.toBeUndefined();
	button!.click();
	return button!;
}

function patchBodies(bodies: unknown[]) {
	return bodies.filter((b) => b !== undefined && typeof b === "object" && b !== null) as {
		welcome_channels?: welcomeEntry[];
	}[];
}

it("an added channel's picked custom emoji rides the PATCH as emoji_id", async () => {
	const {bodies} = openOnboard();
	await new Promise((r) => setTimeout(r, 50));

	clickButton(I18n.onboarding.addChannel());
	const dialog = [...document.querySelectorAll(".dialogModal")].at(-1)!;
	const slot = dialog.querySelector(".emojiForm");
	expect(slot, "the add-channel dialog offers an emoji input").not.toBeNull();

	picked = new Emoji({id: "999", name: "party", animated: false}, {info: {cdn: ""}} as unknown as InstanceType<typeof Guild>);
	slot!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await new Promise((r) => setTimeout(r, 20));

	clickButton(I18n.submit());
	await new Promise((r) => setTimeout(r, 20));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const added = patch.welcome_channels.find((c) => c.channel_id === "c3");
	expect(added?.emoji_id).toBe("999");
	expect(added, "no emoji_name rides beside a custom id").not.toHaveProperty("emoji_name");
	expect(added, "the raw form string never leaks onto the entry").not.toHaveProperty("emoji");
});

it("an added channel's picked unicode emoji rides as emoji_name", async () => {
	const {bodies} = openOnboard();
	await new Promise((r) => setTimeout(r, 50));

	clickButton(I18n.onboarding.addChannel());
	const dialog = [...document.querySelectorAll(".dialogModal")].at(-1)!;
	const slot = dialog.querySelector(".emojiForm");
	expect(slot, "the add-channel dialog offers an emoji input").not.toBeNull();

	picked = new Emoji({name: "🎉", emoji: "🎉"}, undefined);
	slot!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await new Promise((r) => setTimeout(r, 20));

	clickButton(I18n.submit());
	await new Promise((r) => setTimeout(r, 20));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const added = patch.welcome_channels.find((c) => c.channel_id === "c3");
	expect(added?.emoji_name).toBe("🎉");
	expect(added, "no emoji_id rides beside unicode").not.toHaveProperty("emoji_id");
});

it("rows show their stored emoji and a replace PATCHes the update", async () => {
	const {bodies} = openOnboard();
	await new Promise((r) => setTimeout(r, 50));

	const img = document.querySelector<HTMLImageElement>(".emojiForm img.smallemoji");
	expect(img, "the custom-emoji row shows its emoji").not.toBeNull();
	expect(img!.src).toContain("/emojis/111");
	expect(document.body.textContent).toContain("📜");

	picked = new Emoji({id: "888", name: "wave", animated: false}, {info: {cdn: ""}} as unknown as InstanceType<typeof Guild>);
	img!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await new Promise((r) => setTimeout(r, 20));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("888");
});

it("clearing a row's emoji strips both fields on the wire", async () => {
	const {bodies} = openOnboard();
	await new Promise((r) => setTimeout(r, 50));

	picked = null;
	const img = document.querySelector<HTMLImageElement>(".emojiForm img.smallemoji");
	expect(img, "the custom-emoji row shows its emoji").not.toBeNull();
	img!.closest(".emojiForm")!.parentElement!.querySelector("button")!.click();
	await new Promise((r) => setTimeout(r, 20));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row, "both fields are gone, not set to null").not.toHaveProperty("emoji_id");
	expect(row).not.toHaveProperty("emoji_name");
	expect(row?.description).toBe("say hi");
});

it("a refused emoji replace leaves the entry holding the old emoji", async () => {
	let failing = false;
	const {bodies} = openOnboard(() =>
		failing ? Response.json({message: "boom"}, {status: 500}) : Response.json(SCREEN),
	);
	await new Promise((r) => setTimeout(r, 50));

	picked = new Emoji({id: "888", name: "wave", animated: false}, {info: {cdn: ""}} as unknown as InstanceType<typeof Guild>);
	failing = true;
	let img = document.querySelector<HTMLImageElement>(".emojiForm img.smallemoji");
	expect(img, "the custom-emoji row shows its emoji").not.toBeNull();
	img!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await new Promise((r) => setTimeout(r, 20));
	expect(document.body.textContent).toContain(I18n.requestFailed("boom"));

	// The next whole-screen PATCH (clearing the OTHER row) must still carry the OLD emoji
	// on c1: the refused write reverted the entry instead of leaving the client sure of a
	// state the server lacks.
	failing = false;
	picked = null;
	const secondForm = [...document.querySelectorAll(".emojiForm")][1];
	expect(secondForm, "the unicode row renders its emoji slot").not.toBeUndefined();
	secondForm!.parentElement!.querySelector("button")!.click();
	await new Promise((r) => setTimeout(r, 20));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("111");
	expect(row?.emoji_name).toBe("wave");
	const cleared = patch.welcome_channels.find((c) => c.channel_id === "c2");
	expect(cleared, "the clear itself still worked").not.toHaveProperty("emoji_name");
});
