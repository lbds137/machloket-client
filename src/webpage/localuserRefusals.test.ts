import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://localuser-refusals.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, #servers").forEach((e) => e.remove());
});

function makeUser(extra: Record<string, unknown> = {}) {
	return Object.assign(
		Object.create(Localuser.prototype),
		{
			info: {api: API, cdn: API},
			headers: {},
		},
		extra,
	) as InstanceType<typeof Localuser>;
}

it("makeGuild returns false and opens a refusal dialog on a 50035 body or network failure, and true with no dialog on 200", async () => {
	await I18n.done;
	const user = makeUser();
	const shown = vi.spyOn(Dialog.prototype, "show");

	captureRequests(API + "/guilds", () =>
		Response.json(
			{
				code: 50035,
				message: "Invalid Form Body",
				errors: {name: {_errors: [{message: "Must be between 2 and 100 in length."}]}},
			},
			{status: 400},
		),
	);
	expect(await user.makeGuild({name: "a", icon: null})).toBe(false);
	expect(shown).toHaveBeenCalledOnce();
	expect(document.body.textContent).toContain("Must be between 2 and 100 in length.");

	shown.mockClear();
	captureRequests(API + "/guilds", () => {
		throw new TypeError("Failed to fetch");
	});
	expect(await user.makeGuild({name: "Server", icon: null})).toBe(false);
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	captureRequests(API + "/guilds", () => Response.json({id: "g1", name: "Server"}));
	expect(await user.makeGuild({name: "Server", icon: null})).toBe(true);
	expect(shown).not.toHaveBeenCalled();
});

it("a refused server creation brings its form back before the refusal opens, so the refusal is on top", async () => {
	await I18n.done;
	const order: string[] = [];
	vi.spyOn(Dialog.prototype, "show").mockImplementation(() => {
		order.push("refusal");
		return document.createElement("div");
	});
	captureRequests(API + "/guilds", () => new Response(null, {status: 403}));

	await makeUser().makeGuild({name: "Server", icon: null}, () => order.push("form back"));

	expect(order).toEqual(["form back", "refusal"]);
});

it("saveGuildOrder records accepted folders on 200, and on 403 restores guildFolders, rebuilds #servers, and opens a dialog", async () => {
	await I18n.done;
	const servers = document.createElement("div");
	servers.id = "servers";
	document.body.append(servers);

	const folder = (name: string) => ({id: 1, name, color: 0, guilds: [{id: "g1"}]});
	const lookingHtml = document.createElement("div");
	const user = makeUser({
		guildFolders: [],
		guildOrder: [folder("first")],
		lookingguild: {html: lookingHtml},
	});
	const buildservers = vi.spyOn(user, "buildservers").mockImplementation(() => {
		servers.append(document.createElement("span"));
	});
	const shown = vi.spyOn(Dialog.prototype, "show");

	// Accepted save: records the sent guild_folders without rebuilding.
	captureRequests(API + "/users/@me/settings", () => Response.json({}));
	await user.saveGuildOrder();
	const accepted = [{id: 1, name: "first", guild_ids: ["g1"], color: 0}];
	expect(user.guildFolders).toEqual(accepted);
	expect(buildservers).not.toHaveBeenCalled();
	expect(shown).not.toHaveBeenCalled();

	// Refused save: restores guildFolders to accepted, empties and rebuilds #servers, marks open guild, opens dialog.
	servers.append(document.createElement("div"), document.createElement("div"));
	user.guildFolders = [{id: 1, name: "mutated", guild_ids: ["g1"], color: 0}];
	user.guildOrder = [folder("refused")] as never;
	captureRequests(API + "/users/@me/settings", () => new Response(null, {status: 403}));
	await user.saveGuildOrder();

	expect(user.guildFolders).toEqual(accepted);
	expect(buildservers).toHaveBeenCalledOnce();
	expect(servers.childElementCount).toBe(1);
	expect(lookingHtml.classList.contains("serveropen")).toBe(true);
	expect(shown).toHaveBeenCalledOnce();
});

it("saveGuildOrder ignores a refusal that a newer save superseded", async () => {
	await I18n.done;
	let firstAnswer!: (res: Response) => void;
	let call = 0;
	captureRequests(API + "/users/@me/settings", () =>
		++call === 1
			? new Promise<Response>((res) => (firstAnswer = res))
			: Response.json({}),
	);

	const folder = (name: string) => ({id: 1, name, color: 0, guilds: [{id: "g1"}]});
	const user = makeUser({
		guildFolders: [],
		guildOrder: [folder("stale")],
	});
	const buildservers = vi.spyOn(user, "buildservers").mockImplementation(() => {});
	const shown = vi.spyOn(Dialog.prototype, "show");

	const first = user.saveGuildOrder();
	await vi.waitFor(() => expect(firstAnswer).toBeDefined());

	user.guildOrder = [folder("fresh")] as never;
	const second = user.saveGuildOrder();
	await second;

	firstAnswer(new Response(null, {status: 403}));
	await first;

	expect(user.guildFolders).toEqual([{id: 1, name: "fresh", guild_ids: ["g1"], color: 0}]);
	expect(buildservers).not.toHaveBeenCalled();
	expect(shown).not.toHaveBeenCalled();
});

it("status picker shows a refusal dialog when the current status PATCH is refused, and stays silent when superseded", async () => {
	await I18n.done;
	const setstatus = vi.fn();
	const user = makeUser({
		user: {status: "online", setstatus},
	});
	Localuser.openStatusDialog(user);
	const select = document.querySelector("select")!;
	const pick = (index: number) => {
		select.selectedIndex = index;
		select.dispatchEvent(new Event("change"));
	};

	const shown = vi.spyOn(Dialog.prototype, "show");

	// Current request refused: opens refusal dialog and leaves status untouched.
	let answerRefused!: (res: Response) => void;
	captureRequests(
		API + "/users/@me/settings",
		() => new Promise<Response>((res) => (answerRefused = res)),
	);
	pick(2);
	await vi.waitFor(() => expect(answerRefused).toBeDefined());
	answerRefused(new Response(null, {status: 403}));
	await vi.waitFor(() => expect(shown).toHaveBeenCalledOnce());
	expect(setstatus).not.toHaveBeenCalled();

	// Superseded request refused: stays silent.
	shown.mockClear();
	let firstAnswer!: (res: Response) => void;
	let call = 0;
	captureRequests(API + "/users/@me/settings", () =>
		++call === 1
			? new Promise<Response>((res) => (firstAnswer = res))
			: Response.json({}),
	);
	pick(3);
	await vi.waitFor(() => expect(firstAnswer).toBeDefined());
	pick(1);
	await vi.waitFor(() => expect(setstatus).toHaveBeenCalledWith("invisible"));
	firstAnswer(new Response(null, {status: 500}));
	await new Promise((r) => setTimeout(r, 20));
	expect(shown).not.toHaveBeenCalled();
});

it("a refused bot creation says so and keeps no token; an accepted one keeps the token", async () => {
	await I18n.done;
	const shown = vi.spyOn(Dialog.prototype, "show");
	const user = makeUser({botTokens: new Map()});

	captureRequests(API + "/applications/app1/bot", () => new Response(null, {status: 403}));
	expect(await user.addBot("app1")).toBe(false);
	expect(shown).toHaveBeenCalledOnce();
	expect(user.botTokens.has("app1")).toBe(false);

	captureRequests(API + "/applications/app1/bot", () => Response.json({token: "tok"}));
	expect(await user.addBot("app1")).toBe(true);
	expect(user.botTokens.get("app1")).toBe("tok");
});
