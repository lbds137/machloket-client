import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Bot} = await import("./bot");
const {User} = await import("./user");
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://botleave.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

it("leaving a guild from the bot settings drops its row on one DELETE", async () => {
	const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
	const listBodies = captureRequests(API + "/users/@me/guilds/", () =>
		Response.json([{id: "g1", name: "Bot Guild", icon: null, banner: null}]),
	);
	let answer!: (res: Response) => void;
	let leaves = 0;
	const bodies = captureRequests(API + "/users/@me/guilds/g1", () => {
		++leaves;
		return leaves === 1
			? new Promise<Response>((res) => (answer = res))
			: Response.json({message: "Unknown Guild"}, {status: 404});
	});
	// The settings page renders the bot's profile as a side effect; keep it to a stub.
	vi.spyOn(User.prototype, "buildprofile").mockResolvedValue(document.createElement("div"));
	vi.spyOn(User.prototype, "clone").mockReturnValue({
		pronouns: "",
		bio: "",
		buildprofile: async () => document.createElement("div"),
	} as never);

	const owner = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: API},
		headers: {},
		guilds: [],
		userMap: new Map(),
	}) as InstanceType<typeof Localuser>;
	const bot = new Bot({id: "b1", username: "Bot", bot: true} as never, "tok", owner);

	bot.settings();
	await vi.waitFor(() => expect(listBodies).toHaveLength(1));
	// The guilds panel builds detached until its tab activates.
	[...document.querySelectorAll("button")]
		.find((b) => b.textContent === I18n.guild.guilds())!
		.click();
	await vi.waitFor(() => expect(document.querySelector(".discovery-guild")).not.toBeNull());

	document.querySelector<HTMLElement>(".discovery-guild")!.click();
	const leave = [...document.querySelectorAll("button")].find(
		(b) => b.textContent === I18n.leaveGuild(),
	);
	expect(leave).toBeDefined();

	leave!.click();
	await vi.waitFor(() => expect(answer).toBeDefined());
	leave!.click(); // second tap while the DELETE is in flight
	answer(Response.json({}));

	// The handler finished when the row leaves the document.
	await vi.waitFor(() => expect(document.querySelector(".discovery-guild")).toBeNull());
	expect(bodies).toHaveLength(1);
	expect(confirm).toHaveBeenCalledOnce();
	expect(
		[...document.querySelectorAll("button")].some((b) => b.textContent === I18n.leaveGuild()),
	).toBe(false);
});
