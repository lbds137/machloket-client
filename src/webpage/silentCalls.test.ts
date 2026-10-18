import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Channel} = await import("./channel");
const {Group} = await import("./direct");
const {Message} = await import("./message");
const {User} = await import("./user");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://silent.test/api/v9";
const CHANNELS = API + "/guilds/g1/channels";
const refused = () => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		inrelation: new Set(),
	}) as InstanceType<typeof Localuser>;
}

function guild() {
	return Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels: [],
		owner: localuser(),
	}) as InstanceType<typeof Guild>;
}

function channel(owner = guild()) {
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {Authorization: "t"},
		owner,
	}) as InstanceType<typeof Channel>;
}

function group() {
	return Object.assign(Object.create(Group.prototype), {
		id: "dm1",
		name: "Chat",
		headers: {Authorization: "t"},
		users: [],
		owner: guild(),
	}) as InstanceType<typeof Group>;
}

it("a refused guild channel create says why and does not navigate", async () => {
	captureRequests(CHANNELS, refused);
	const g = guild();
	const goTo = vi.spyOn(g, "goToChannelDelay");

	const ok = await g.createChannel("general", 0);

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
	expect(goTo).not.toHaveBeenCalled();
	expect(ok).toBe(false);
});

it("an accepted guild channel create navigates to the new channel id", async () => {
	const sent = captureRequests(CHANNELS, () => Response.json({id: "c9"}));
	const g = guild();
	const goTo = vi.spyOn(g, "goToChannelDelay");

	const ok = await g.createChannel("general", 0);

	expect(goTo).toHaveBeenCalledWith("c9");
	expect(ok).toBe(true);
	expect(sent).toEqual([{name: "general", type: 0}]);
});

it("a refused category channel create says why and does not navigate", async () => {
	captureRequests(CHANNELS, refused);
	const g = guild();
	const goTo = vi.spyOn(g, "goToChannelDelay");

	const ok = await channel(g).createChannel("notes", 0);

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
	expect(goTo).not.toHaveBeenCalled();
	expect(ok).toBe(false);
});

it("a refused createchannels submission keeps its dialog open", async () => {
	captureRequests(CHANNELS, refused);
	const addForm = vi.spyOn(Options.prototype, "addForm");
	const hide = vi.spyOn(Dialog.prototype, "hide");
	guild().createchannels();
	const form = addForm.mock.results[0].value as {submit(): Promise<void>};

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused createcategory submission keeps its dialog open", async () => {
	captureRequests(CHANNELS, refused);
	const addForm = vi.spyOn(Options.prototype, "addForm");
	const hide = vi.spyOn(Dialog.prototype, "hide");
	guild().createcategory();
	const form = addForm.mock.results[0].value as {submit(): Promise<void>};

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused group DM kick says why", async () => {
	captureRequests(API + "/channels/dm1/recipients/u2", refused);
	const kickBtn = (
		Group.groupMenu as unknown as {
			buttons: {onClick: (this: unknown, user: unknown, e: MouseEvent) => Promise<void>}[];
		}
	).buttons[0];

	await kickBtn.onClick.call(group(), {id: "u2", name: "Eve"}, new MouseEvent("click"));

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused group DM recipient add says why", async () => {
	captureRequests(API + "/channels/dm1/recipients/u2", refused);
	vi.spyOn(User, "makeSelector").mockResolvedValue(new Set([{id: "u2"} as never]));

	await group().addPerson();

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused poll expire keeps its confirmation dialog open and says why", async () => {
	captureRequests(API + "/channels/c1/polls/m1/expire", refused);
	const hide = vi.spyOn(Dialog.prototype, "hide");
	const msg = Object.assign(Object.create(Message.prototype), {
		id: "m1",
		headers: {Authorization: "t"},
		owner: channel(),
	}) as InstanceType<typeof Message>;
	msg.confirmDeletePoll();
	const yes = [...document.querySelectorAll("button")].find((b) => b.textContent === I18n.yes())!;

	yes.click();
	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);

	expect(hide).not.toHaveBeenCalled();
});
