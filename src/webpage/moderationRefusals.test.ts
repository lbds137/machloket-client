import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Member} = await import("./member");
const {User} = await import("./user");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://moderate.test/api/v9";
const MEMBER = API + "/guilds/g1/members/m1";
const refused = () => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403});
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function localuser() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
	}) as InstanceType<typeof Localuser>;
}

function guild() {
	const role = {id: "r1"};
	return Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		properties: {name: "Home"},
		headers: {Authorization: "t"},
		roles: [role],
		// `localuser` and `info` are getters on the prototype: they read through the owner.
		owner: localuser(),
	}) as InstanceType<typeof Guild>;
}

/** Member "m1" (nicknamed Bob, holding role r1). */
function member() {
	return Object.assign(Object.create(Member.prototype), {
		id: "m1",
		nick: "Bob",
		roleIds: new Set(["r1"]),
		owner: guild(),
	}) as MemberT;
}

/** Opens one of the member's moderation dialogs and returns its form. */
function open(action: "kick" | "ban" | "timeout") {
	const addForm = vi.spyOn(Options.prototype, "addForm");
	const hide = vi.spyOn(Dialog.prototype, "hide");
	member()[action]();
	const form = addForm.mock.results[0].value as {submit(): Promise<void>};
	return {form, hide};
}

it("a refused kick keeps its dialog open and says why", async () => {
	captureRequests(MEMBER, refused);
	const {form, hide} = open("kick");

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused ban keeps its dialog open and says why", async () => {
	captureRequests(API + "/guilds/g1/bans/m1", refused);
	const {form, hide} = open("ban");

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a timeout that never reached the server keeps its dialog open and says so", async () => {
	captureRequests(MEMBER, offline);
	const {form, hide} = open("timeout");

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

// A pin, not red-first: the old code closed the dialog too.
it("an accepted kick closes its dialog", async () => {
	const sent = captureRequests(MEMBER, () => new Response(null, {status: 204}));
	const {form, hide} = open("kick");

	await form.submit();

	expect(sent).toHaveLength(1);
	expect(hide).toHaveBeenCalled();
});

it("a refused end of a timeout says so", async () => {
	captureRequests(MEMBER, () => new Response("<html>bad gateway</html>", {status: 502}));

	await member().removeTimeout();

	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 502"));
});

it("adding a role asks for that one role, so it can't drop another added meanwhile", async () => {
	const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 204}));

	await member().addRole({id: "r2"} as never);

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(String(fetch.mock.calls[0][0])).toBe(MEMBER + "/roles/r2");
	expect(fetch.mock.calls[0][1]?.method).toBe("PUT");
});

it("removing a role asks for that one role", async () => {
	const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 204}));

	await member().removeRole({id: "r1"} as never);

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(String(fetch.mock.calls[0][0])).toBe(MEMBER + "/roles/r1");
	expect(fetch.mock.calls[0][1]?.method).toBe("DELETE");
});

it("a refused role change says why", async () => {
	captureRequests(MEMBER + "/roles/r2", refused);

	await member().addRole({id: "r2"} as never);

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

it("a refused unban says why and reports it wasn't lifted", async () => {
	captureRequests(API + "/guilds/g1/bans/u9", refused);

	expect(await guild().unban("u9")).toBe(false);
	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
});

// A pin for the new method's success answer.
it("an accepted unban reports it was lifted", async () => {
	const sent = captureRequests(API + "/guilds/g1/bans/u9", () => new Response(null, {status: 204}));

	expect(await guild().unban("u9")).toBe(true);
	expect(sent).toHaveLength(1);
});

it("a refused instance ban keeps its dialog open and says why", async () => {
	captureRequests(API + "/users/u9/delete", refused);
	const hide = vi.spyOn(Dialog.prototype, "hide");
	const user = Object.assign(Object.create(User.prototype), {id: "u9", owner: localuser()});
	const button = (
		User.contextmenu as unknown as {
			buttons: {text?: unknown; onClick: (this: unknown, ...args: unknown[]) => void}[];
		}
	).buttons.find(
		(b) => typeof b.text === "function" && (b.text as () => string)() === I18n.user.instanceBan(),
	)!;
	button.onClick.call(user, undefined, new MouseEvent("click"));
	const yes = [...document.querySelectorAll("button")].find((b) => b.textContent === I18n.yes())!;

	yes.click();
	await vi.waitFor(() =>
		expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);

	expect(hide).not.toHaveBeenCalled();
});
