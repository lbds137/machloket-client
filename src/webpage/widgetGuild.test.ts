import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {User} = await import("./user");
const {Member} = await import("./member");
const {I18n} = await import("./i18n");
const {PromiseLock} = await import("./utils/promiseLock");

// Button labels hydrate asynchronously; drive the widget only once they have landed.
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
});

/** The widget's avatar slot: a wrapper whose first child is the image the found-member
 * branch rewrites. */
function pfpSlot() {
	const wrapper = document.createElement("div");
	wrapper.append(document.createElement("img"));
	return wrapper;
}

/** A user whose widget plumbing (avatar, status binding, member name) is stubbed; the
 * member resolution itself is what the pins observe. */
function widgetUser(meGuild: {id: string}) {
	const pfp = pfpSlot();
	const owner = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["@me", meGuild]]),
		info: {api: "http://widget.test/api/v9"},
		headers: {"Content-type": "application/json", Authorization: "t"},
		memberLock: new PromiseLock(),
		waitingmembers: new Map(),
		fetchingmembers: new Map(),
		memberLookupDrops: new Map(),
		noncemap: new Map(),
		noncebuild: new Map(),
		searchMap: new Map(),
		presences: new Map(),
		userMap: new Map(),
		user: {id: "me"},
		memberListQue: () => {},
	}) as InstanceType<typeof Localuser>;
	const user = Object.assign(Object.create(User.prototype), {
		// User.localuser is a getter over `owner` (user.ts:819) — the fixture stores the
		// fake localuser there, not under `localuser`.
		id: "u1",
		members: new Map(),
		owner,
		username: "Widgeted",
		bind: () => {},
		buildpfp: () => pfp,
		subName: vi.fn(),
		getPresence: () => {},
		getpfpsrc: () => "http://pfp.test/user.png",
	}) as InstanceType<typeof User>;
	owner.userMap.set(user.id, user);
	return {pfp, user};
}

it("the widget keeps its layout classes (the chip look lives in .createdWebhook)", () => {
	const {user} = widgetUser({id: "@me"});
	const div = user.createWidget({id: "@me"} as never);
	// flexltr rows the avatar and name; createdWebhook carries the chip styling. Both were
	// once lost to an edit slip — pinned so the loss reddens here instead of on screen.
	expect(div.classList.contains("flexltr")).toBe(true);
	expect(div.classList.contains("createdWebhook")).toBe(true);
});

it("a not-found member gets the inline note, not a stray error badge", async () => {
	const passedGuild = {id: "777"};
	// No bind stub: the REAL bind runs, so its not-found side effects are observable.
	const {user} = widgetUser({id: "@me"});
	const bindSpy = vi.spyOn(user, "bind");
	vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	const div = user.createWidget(passedGuild as never);
	await new Promise((r) => setTimeout(r, 0));

	// The badge suppression is deliberate: the inline note is the only not-found signal.
	expect(bindSpy).toHaveBeenCalledWith(div, passedGuild, false);
	expect(document.querySelector(".membererror")).toBeNull();
	expect(div.textContent).toContain(I18n.webhooks.notFound());
});

it("createWidget resolves the member in the guild the caller passed", async () => {
	const meGuild = {id: "@me"};
	const passedGuild = {id: "777"};
	const {user} = widgetUser(meGuild);
	const spy = vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	user.createWidget(passedGuild as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(spy).toHaveBeenCalledWith(user, passedGuild);
});

it("a member the guild doesn't know gets the not-found note, not silence", async () => {
	const passedGuild = {id: "777"};
	const {user} = widgetUser({id: "@me"});
	vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	const div = user.createWidget(passedGuild as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(div.textContent).toContain(I18n.webhooks.notFound());
});

it("a resolved member names the widget (the control)", async () => {
	const {pfp, user} = widgetUser({id: "@me"});
	vi.spyOn(Member, "resolveMember").mockResolvedValue({
		name: "Guild Named",
		subName: () => {},
		getpfpsrc: () => "http://pfp.test/guild.png",
	} as never);

	const div = user.createWidget({id: "@me"} as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(div.querySelector("b")?.textContent).toBe("Guild Named");
	expect((pfp.children[0] as HTMLImageElement).src).toContain("http://pfp.test/guild.png");
});

it("a member lookup given up after two socket drops does not claim the user left the guild", async () => {
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};
	user.localuser.guildids.set(guild.id, guild as never);

	const div = user.createWidget(guild as never);
	user.localuser.fetchingmembers.set(guild.id, true);
	user.localuser.abandonMemberRequests();
	user.localuser.fetchingmembers.set(guild.id, true);
	user.localuser.abandonMemberRequests();

	await vi.waitFor(() => expect(user.subName).toHaveBeenCalled());
	expect(div.textContent).not.toContain(I18n.webhooks.notFound());
});

it("a REST member lookup answering 500 does not claim the user left the guild", async () => {
	captureRequests(
		"http://widget.test/api/v9/guilds/777/members/u1",
		() => new Response("server error", {status: 500}),
	);
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};

	const div = user.createWidget(guild as never);

	await vi.waitFor(() => expect(user.subName).toHaveBeenCalled());
	expect(div.textContent).not.toContain(I18n.webhooks.notFound());
});

it("a REST member lookup whose fetch rejects does not claim the user left the guild", async () => {
	captureRequests("http://widget.test/api/v9/guilds/777/members/u1", () =>
		Promise.reject(new TypeError("network error")),
	);
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};

	const div = user.createWidget(guild as never);

	await vi.waitFor(() => expect(user.subName).toHaveBeenCalled());
	expect(div.textContent).not.toContain(I18n.webhooks.notFound());
});

it("a REST 404 still shows the not-found note (control)", async () => {
	captureRequests(
		"http://widget.test/api/v9/guilds/777/members/u1",
		() => new Response("unknown member", {status: 404}),
	);
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};

	const div = user.createWidget(guild as never);

	await vi.waitFor(() => expect(div.textContent).toContain(I18n.webhooks.notFound()));
});

it("a gateway not_found still shows the not-found note (control)", async () => {
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};
	user.localuser.guildids.set(guild.id, guild as never);
	user.localuser.ws = {
		readyState: WebSocket.OPEN,
		send(raw: string) {
			const {d} = JSON.parse(raw) as {d: {nonce: string; user_ids: string[]}};
			user.localuser.gotChunk({
				chunk_index: 0,
				chunk_count: 1,
				nonce: d.nonce,
				not_found: d.user_ids,
				presences: [],
			});
		},
	} as never;

	const div = user.createWidget(guild as never);

	await vi.waitFor(() => expect(div.textContent).toContain(I18n.webhooks.notFound()));
});

it("a resolved member in a guild shows no not-found note (control)", async () => {
	captureRequests("http://widget.test/api/v9/guilds/777/members/u1", () =>
		Response.json({user: {id: "u1", username: "Widgeted"}, nick: "Guild Named", roles: []}),
	);
	const {user} = widgetUser({id: "@me"});
	const guild = {id: "777", localuser: user.localuser, members: new Set()};

	const div = user.createWidget(guild as never);

	await vi.waitFor(() => expect(div.querySelector("b")?.textContent).toBe("Guild Named"));
	expect(div.textContent).not.toContain(I18n.webhooks.notFound());
});
