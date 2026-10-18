import {afterEach, expect, it} from "vitest";
import {captureRequests} from "./test/setup";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Member} = await import("./member");
const {Bot} = await import("./bot");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://profile.test/api/v9";
const TOO_LONG = "Must be between 0 and 190 in length.";
/** The server's answer to a field it won't take: the reason sits under `errors`, not `message`. */
const invalidForm = () =>
	Response.json(
		{
			code: 50035,
			message: "Invalid Form Body",
			errors: {bio: {_errors: [{code: "BASE_TYPE_BAD_LENGTH", message: TOO_LONG}]}},
		},
		{status: 400},
	);
const image = () => new Blob(["not really a png"], {type: "image/png"});

afterEach(() => {
	document.body.replaceChildren();
});

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
	}) as InstanceType<typeof Localuser>;
}

function member() {
	const guild = Object.assign(Object.create(Guild.prototype), {id: "g1", owner: localuser()});
	return Object.assign(Object.create(Member.prototype), {id: "m1", owner: guild}) as MemberT;
}

function bot() {
	return Object.assign(Object.create(Bot.prototype), {
		owner: localuser(),
		headers: {"Content-type": "application/json", Authorization: "Bot t"},
	}) as InstanceType<typeof Bot>;
}

const saves: [string, string, () => Promise<unknown> | unknown][] = [
	["your avatar", "/users/@me", () => localuser().updatepfp(image())],
	["removing your avatar", "/users/@me", () => localuser().updatepfp(null)],
	["your banner", "/users/@me", () => localuser().updatebanner(image())],
	["your profile", "/users/@me/profile", () => localuser().updateProfile({bio: "x"})],
	["a server avatar", "/guilds/g1/members/m1/", () => member().updatepfp(image())],
	["a server banner", "/guilds/g1/profile/m1", () => member().updatebanner(image())],
	["a server profile", "/guilds/g1/profile/m1", () => member().updateProfile({bio: "x"})],
	["a bot's avatar", "/users/@me", () => bot().updatepfp(image())],
	["a bot's banner", "/users/@me", () => bot().updatebanner(null)],
	["a bot's profile", "/users/@me/profile", () => bot().updateProfile({bio: "x"})],
];

it.each(saves)("a refused save of %s says what the server wouldn't take", async (_, path, save) => {
	captureRequests(API + path, invalidForm);

	const saved = await save();

	expect(document.body.textContent).toContain(I18n.requestFailed(TOO_LONG));
	expect(saved).toBe(false);
});

it("a profile save that never reached the server says it's offline", async () => {
	captureRequests(API + "/users/@me/profile", () =>
		Promise.reject(new TypeError("Failed to fetch")),
	);

	const saved = await localuser().updateProfile({bio: "x"});

	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
	expect(saved).toBe(false);
});

it("a saved profile says nothing", async () => {
	const sent = captureRequests(API + "/users/@me", () => Response.json({}));

	expect(await localuser().updatepfp(image())).toBe(true);

	expect(sent).toEqual([{avatar: expect.stringMatching(/^data:image\/png;base64,/)}]);
	expect(document.body.textContent).toBe("");
});

it("removing a picture sends null for it", async () => {
	const sent = captureRequests(API + "/guilds/g1/members/m1/", () => Response.json({}));

	expect(await member().updatepfp(null)).toBe(true);

	expect(sent).toEqual([{avatar: null}]);
});
