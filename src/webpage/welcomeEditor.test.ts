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
		emojis: [{id: "111", animated: true}],
		properties: {name: "G", features: []},
		member: {hasPermission: (perm: string) => perm === "MANAGE_GUILD"},
		owner: settingsUser(),
	}) as unknown as InstanceType<typeof Guild>;
	g.perminfo = {channels: {}};
	return g;
}

/** Opens guild settings, mounts the onboarding section (sections mount on their rail
 * button's click) and captures the welcome-screen endpoint. */
function openOnboard(respond: () => Response | Promise<Response> = () => Response.json(SCREEN)) {
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

const rowSlotImg = () => document.querySelector<HTMLImageElement>(".emojiForm img.smallemoji");

/** A custom picker return for the tests: a minimal owner satisfies Emoji.getHTML's CDN read. */
function customEmoji(id: string, name: string) {
	return new Emoji({id, name, animated: false}, {info: {cdn: ""}} as unknown as InstanceType<typeof Guild>);
}

it("an added channel's picked custom emoji rides with its name", async () => {
	const {bodies} = openOnboard();
	await vi.waitFor(() => expect(clickButtonAddChannelVisible()).toBeTruthy());

	clickButton(I18n.onboarding.addChannel());
	const dialog = [...document.querySelectorAll(".dialogModal")].at(-1)!;
	const slot = dialog.querySelector(".emojiForm");
	expect(slot, "the add-channel dialog offers an emoji input").not.toBeNull();

	picked = customEmoji("999", "party");
	slot!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(dialog.querySelector(".emojiForm img.smallemoji")).not.toBeNull());

	clickButton(I18n.submit());
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(0));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const added = patch.welcome_channels.find((c) => c.channel_id === "c3");
	// Discord's welcome-channel shape carries the custom emoji's name beside its id.
	expect(added?.emoji_id).toBe("999");
	expect(added?.emoji_name).toBe("party");
	expect(added, "the raw form string never leaks onto the entry").not.toHaveProperty("emoji");
});

/** The add-channel button renders once the fetched screen fills the section. */
function clickButtonAddChannelVisible() {
	return [...document.querySelectorAll("button")].some(
		(b) => b.textContent === I18n.onboarding.addChannel(),
	);
}

it("an added channel's picked unicode emoji rides as emoji_name", async () => {
	const {bodies} = openOnboard();
	await vi.waitFor(() => expect(clickButtonAddChannelVisible()).toBeTruthy());

	clickButton(I18n.onboarding.addChannel());
	const dialog = [...document.querySelectorAll(".dialogModal")].at(-1)!;
	const slot = dialog.querySelector(".emojiForm");
	expect(slot, "the add-channel dialog offers an emoji input").not.toBeNull();

	picked = new Emoji({name: "🎉", emoji: "🎉"}, undefined);
	slot!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(dialog.querySelector(".emojiForm span.smallemoji")).not.toBeNull());

	clickButton(I18n.submit());
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(0));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const added = patch.welcome_channels.find((c) => c.channel_id === "c3");
	expect(added?.emoji_name).toBe("🎉");
	expect(added, "no emoji_id rides beside unicode").not.toHaveProperty("emoji_id");
});

it("rows show their stored emoji (animated per the guild's list) and a replace PATCHes the update", async () => {
	const {bodies} = openOnboard();
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	const img = rowSlotImg()!;
	expect(img.src).toContain("/emojis/111.gif");
	expect(document.body.textContent).toContain("📜");

	picked = customEmoji("888", "wave");
	img.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/888"));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("888");
});

it("clearing a row's emoji strips both fields on the wire", async () => {
	const {bodies} = openOnboard();
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	picked = null;
	const img = rowSlotImg()!;
	img.closest(".emojiForm")!.parentElement!.querySelector("button")!.click();
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(0));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row, "both fields are gone, not set to null").not.toHaveProperty("emoji_id");
	expect(row).not.toHaveProperty("emoji_name");
	expect(row?.description).toBe("say hi");
});

it("a pick by an immediate-save input raises no unsaved-changes bar", async () => {
	openOnboard();
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	picked = customEmoji("888", "wave");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/888"));

	// The input PATCHes immediately; a bar promising unsaved changes would be a lie, and
	// its Save would send a redundant whole-screen PATCH.
	expect(document.querySelector(".savediv")).toBeNull();
});

it("a refused emoji replace restores the visible slot and holds the old emoji", async () => {
	let failing = false;
	const {bodies} = openOnboard(() =>
		failing ? Response.json({message: "boom"}, {status: 500}) : Response.json(SCREEN),
	);
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	picked = customEmoji("888", "wave");
	failing = true;
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(document.body.textContent).toContain(I18n.requestFailed("boom")));

	// The model reverts (pinned below through the next PATCH) and the slot must follow it:
	// the admin sees the emoji the server actually holds, not the rejected pick.
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/111"));

	// The next whole-screen PATCH (clearing the OTHER row) must still carry the OLD emoji
	// on c1: the refused write reverted the entry instead of leaving the client sure of a
	// state the server lacks.
	failing = false;
	picked = null;
	const secondForm = [...document.querySelectorAll(".emojiForm")][1];
	expect(secondForm, "the unicode row renders its emoji slot").not.toBeUndefined();
	secondForm!.parentElement!.querySelector("button")!.click();
	await vi.waitFor(() => {
		const patch = patchBodies(bodies).filter((b) => "welcome_channels" in (b as object)).at(-1) as
			| {welcome_channels: welcomeEntry[]}
			| undefined;
		expect(patch?.welcome_channels.find((c) => c.channel_id === "c2")).toBeDefined();
	});

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("111");
	expect(row?.emoji_name).toBe("wave");
	const cleared = patch.welcome_channels.find((c) => c.channel_id === "c2");
	expect(cleared, "the clear itself still worked").not.toHaveProperty("emoji_name");
});

it("a failed pick does not clobber a pick that landed after it", async () => {
	let failing = false;
	const {bodies} = openOnboard(() => {
		if (!failing) return Response.json(SCREEN);
		// Hold the refused answer in flight so the next pick's PATCH overtakes it.
		return new Promise((res) =>
			setTimeout(() => res(Response.json({message: "boom"}, {status: 500})), 150),
		);
	});
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	// Pick A enters flight while failing; pick B lands before A's refusal arrives.
	failing = true;
	picked = customEmoji("888", "wave");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(0));
	failing = false;
	picked = customEmoji("777", "party");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/777"));

	// A's late refusal must NOT write the pre-A emoji back over B's landed pick.
	await new Promise((r) => setTimeout(r, 200));

	// A whole-screen PATCH from the other row exposes the settled state.
	picked = null;
	const secondForm = [...document.querySelectorAll(".emojiForm")][1];
	secondForm!.parentElement!.querySelector("button")!.click();
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(2));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("777");
});

it("a pick on the same row after a refusal leaves exactly one emoji in the slot", async () => {
	let failing = false;
	openOnboard(() =>
		failing ? Response.json({message: "boom"}, {status: 500}) : Response.json(SCREEN),
	);
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	picked = customEmoji("888", "wave");
	failing = true;
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(document.body.textContent).toContain(I18n.requestFailed("boom")));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/111"));

	// The slot was rebuilt by the revert; the next pick must replace its emoji, not stack
	// a new one beside the restored element.
	failing = false;
	picked = customEmoji("777", "party");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/777"));

	const form = rowSlotImg()!.closest(".emojiForm")!;
	expect(form.querySelectorAll(".smallemoji"), "one emoji element after the re-edit").toHaveLength(1);
});

it("two overlapping refused picks revert to the last server-confirmed emoji", async () => {
	let failing = false;
	const {bodies} = openOnboard(() => {
		if (!failing) return Response.json(SCREEN);
		return new Promise((res) =>
			setTimeout(() => res(Response.json({message: "boom"}, {status: 500})), 150),
		);
	});
	await vi.waitFor(() => expect(rowSlotImg()).not.toBeNull());

	// A and B both enter flight while failing; both refusals arrive late. Neither lands,
	// so the client must fall back to the fetched emoji — not to either pick.
	failing = true;
	picked = customEmoji("888", "wave");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(0));
	picked = customEmoji("777", "party");
	rowSlotImg()!.closest(".emojiForm")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	await vi.waitFor(() => expect(rowSlotImg()?.src).toContain("/emojis/777"));

	await new Promise((r) => setTimeout(r, 250));

	picked = null;
	const secondForm = [...document.querySelectorAll(".emojiForm")][1];
	secondForm!.parentElement!.querySelector("button")!.click();
	await vi.waitFor(() => expect(patchBodies(bodies).length).toBeGreaterThan(2));

	const patch = patchBodies(bodies).at(-1) as {welcome_channels: welcomeEntry[]};
	const row = patch.welcome_channels.find((c) => c.channel_id === "c1");
	expect(row?.emoji_id).toBe("111");
	expect(row?.emoji_name).toBe("wave");
});
