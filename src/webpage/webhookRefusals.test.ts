import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Settings, Dialog} = await import("./settings");
const {webhookMenu} = await import("./webhooks");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://hooks.test/api/v9";
const LIST = API + "/guilds/g1/webhooks";
const refused = () => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403});
const hook = {
	id: "1553128655016763450",
	name: "Captain Hook",
	type: 1,
	channel_id: "c1",
	token: "t",
};

const initialLang = I18n.lang;

afterEach(() => {
	I18n.lang = initialLang;
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** Opens the webhooks pane of guild g1, whose one channel (c1, #general) the user may add hooks to. */
function openPane(channels = [{id: "c1", name: "general", type: 0, hasPermission: () => true}]) {
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "http://hooks.test"},
		headers: {Authorization: "t"},
	});
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		channels,
		headers: {Authorization: "t"},
		owner: localuser,
	});
	const pane = new Settings("").addButton("Webhooks");
	document.body.append(pane.generateHTML());
	void webhookMenu(guild, LIST, pane);
	return pane;
}

const button = (text: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

it("a webhook list the server won't give says why instead of a blank pane", async () => {
	captureRequests(LIST, refused);

	openPane();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
});

it("a refused new webhook keeps its dialog open and says why", async () => {
	captureRequests(LIST, () => Response.json([]));
	captureRequests(API + "/channels/c1/webhooks/", refused);
	const hide = vi.spyOn(Dialog.prototype, "hide");
	openPane();
	await vi.waitFor(() => button(I18n.webhooks.newWebHook()));

	button(I18n.webhooks.newWebHook()).click();
	button(I18n.submit()).click();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
	expect(hide).not.toHaveBeenCalled();
});

it("a new webhook joins the list once made", async () => {
	captureRequests(LIST, () => Response.json([]));
	captureRequests(API + "/channels/c1/webhooks/", () => Response.json(hook));
	const hide = vi.spyOn(Dialog.prototype, "hide");
	openPane();
	await vi.waitFor(() => button(I18n.webhooks.newWebHook()));

	button(I18n.webhooks.newWebHook()).click();
	button(I18n.submit()).click();

	await vi.waitFor(() => expect(document.body.textContent).toContain("Captain Hook"));
	expect(hide).toHaveBeenCalled();
});

it("with no channel to put one in, there's no New webhook button to fail", async () => {
	captureRequests(LIST, () => Response.json([hook]));

	openPane([]);
	await vi.waitFor(() => expect(document.querySelector(".webhookArea")).not.toBeNull());

	expect(button(I18n.webhooks.newWebHook())).toBeUndefined();
});

it("a webhook list that never arrived says it's offline", async () => {
	captureRequests(LIST, () => Promise.reject(new TypeError("Failed to fetch")));

	openPane();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("offline")),
	);
});

it("a webhook list that isn't a list says so", async () => {
	captureRequests(LIST, () => Response.json({}));

	openPane();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200")),
	);
});

it("clicking Submit again while the first is on its way makes one webhook", async () => {
	let answer: (res: Response) => void = () => {};
	captureRequests(LIST, () => Response.json([]));
	const sent = captureRequests(
		API + "/channels/c1/webhooks/",
		() => new Promise<Response>((r) => (answer = r)),
	);
	openPane();
	await vi.waitFor(() => button(I18n.webhooks.newWebHook()));

	button(I18n.webhooks.newWebHook()).click();
	button(I18n.submit()).click();
	button(I18n.submit()).click();
	answer(Response.json(hook));

	await vi.waitFor(() => expect(document.body.textContent).toContain("Captain Hook"));
	expect(sent).toHaveLength(1);
});

it("a refused delete says why and keeps the webhook", async () => {
	captureRequests(LIST, () => Response.json([hook]));
	captureRequests(API + "/webhooks/" + hook.id, refused);
	const hide = vi.spyOn(Dialog.prototype, "hide");
	openPane();
	await vi.waitFor(() => expect(document.querySelector(".webhookArea")).not.toBeNull());

	(document.querySelector(".webhookArea") as HTMLElement).click();
	button(I18n.webhooks.deleteWebhook()).click();
	button(I18n.yes()).click();

	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
	expect(hide).not.toHaveBeenCalled();
});

it("a listed webhook formats its creation date with I18n.locale", async () => {
	vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
	I18n.lang = "en";
	captureRequests(LIST, () => Response.json([hook]));

	openPane();
	await vi.waitFor(() => expect(document.querySelector(".webhookArea")).not.toBeNull());

	const stamp = Number((BigInt(hook.id) >> 22n) + 1420070400000n);
	expect(document.querySelector(".webhookArea .flexttb > span")?.textContent).toBe(
		I18n.webhooks.createdAt(new Intl.DateTimeFormat("en-GB").format(stamp)),
	);
});
