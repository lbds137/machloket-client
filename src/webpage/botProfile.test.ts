import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Bot} = await import("./bot");
const {Settings} = await import("./settings");
const {User} = await import("./user");

const API = "http://bot.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
});

type Input = {onchange: (value: string) => void; submit(): void};

/** Opens the bot's profile editor and hands back its pronouns box, bio box and colour picker. */
function openProfile(json: Record<string, unknown>) {
	const sent = captureRequests(API + "/users/@me/profile");
	// Requests the editor makes on the side (the bot's guilds) answer empty.
	captureRequests(API + "/users/@me/guilds/", () => Response.json([]));
	vi.spyOn(User.prototype, "buildprofile").mockResolvedValue(document.createElement("div"));
	const options = Object.getPrototypeOf(new Settings("").addButton("probe"));
	const text = vi.spyOn(options, "addTextInput");
	const md = vi.spyOn(options, "addMDInput");
	const color = vi.spyOn(options, "addColorInput");
	const owner = {info: {api: API, cdn: "http://bot.test"}, userMap: new Map(), guilds: []};
	new Bot(
		{id: "b1", username: "bot", discriminator: "0", bio: "", ...json} as never,
		"t",
		owner as never,
	).settings();
	const pronouns = text.mock.results[0].value as Input;
	const bio = md.mock.results[0].value as Input;
	const picker = color.mock.results[0].value as Input;
	return {sent, pronouns, bio, picker, pickerOpened: color.mock.calls[0]};
}

/** The profile saves sent, once the first has gone out. */
async function bodies(sent: unknown[]) {
	await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
	return sent;
}

it("clearing a bot's pronouns saves the cleared pronouns", async () => {
	const {sent, pronouns} = openProfile({pronouns: "it/its"});

	pronouns.onchange("");
	pronouns.submit();

	expect(await bodies(sent)).toEqual([expect.objectContaining({pronouns: ""})]);
});

it("clearing a bot's bio saves the cleared bio", async () => {
	const {sent, pronouns, bio} = openProfile({bio: "Hello"});

	bio.onchange("");
	pronouns.submit();

	expect(await bodies(sent)).toEqual([expect.objectContaining({bio: ""})]);
});

it("saving a bot with no accent colour doesn't send one", async () => {
	const {sent, pronouns} = openProfile({});

	pronouns.onchange("they/them");
	pronouns.submit();

	const [body] = await bodies(sent);
	expect(body).toMatchObject({pronouns: "they/them"});
	expect(body).not.toHaveProperty("accent_color");
});

it("a picked colour is saved as its number", async () => {
	const {sent, pronouns, picker} = openProfile({});

	picker.onchange("#00ff00");
	pronouns.submit();

	expect(await bodies(sent)).toEqual([expect.objectContaining({accent_color: 0x00ff00})]);
});

it("a bot's dark accent colour opens as a full colour in the picker", () => {
	const {pickerOpened} = openProfile({accent_color: 0x0000ff});

	expect(pickerOpened[2]).toEqual({initColor: "#0000ff"});
});
