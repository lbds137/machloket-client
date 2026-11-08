import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Embed} = await import("./embed");
const {Dialog, Form, FormError, Options} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://invite.test/api/v9";
const WELLKNOWN = "http://invite.test";
const GUILD_ID = "700";
const ALREADY_MEMBER = "You are already a member of this guild";

/** The server's already-member refusal: a generic 400 whose message is the only key. */
const alreadyMember = () =>
	new Response(JSON.stringify({message: ALREADY_MEMBER}), {
		status: 400,
		headers: {"Content-Type": "application/json"},
	});

const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("an invite to a guild the user is already in", () => {
	it("the embed's accept opens the guild instead of alerting", async () => {
		const posts = captureRequests(API + "/invites/abc", alreadyMember);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
		// At render time the guild is not in guildids yet (the list hasn't loaded), so the
		// disabled-button guard misses it and the accept stays live, as in the bug.
		const loadGuild = vi.fn();
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
			guildids: new Map(),
			loadGuild,
		});
		const embed = new Embed(
			{type: "invite", invite: {url: WELLKNOWN, code: "abc"}} as never,
			{channel: {guild: {localuser}}} as never,
		);
		// The invite's preview, already fetched: no instance lookup is needed to render it.
		embed.invcache = [
			{
				code: "abc",
				guild: {id: GUILD_ID, name: "Guild", member_count: 3, icon: null, banner: null},
				channel: {name: "general"},
			} as never,
			{cdn: WELLKNOWN + "/cdn", api: API},
		];
		const div = embed.generateHTML() as HTMLElement;
		document.body.append(div);
		const accept = div.querySelector("button.acceptinvbutton") as HTMLButtonElement;
		// The guild arrives after the embed rendered, so the button stayed enabled at render time.
		localuser.guildids.set(GUILD_ID, {id: GUILD_ID, loadChannel: vi.fn(async () => {})});

		accept.click();
		await vi.waitFor(() => expect(posts).toHaveLength(1));
		await flush();

		// The refusal is a success here: no alert, and the guild is opened.
		expect(alert).not.toHaveBeenCalled();
		expect(loadGuild).toHaveBeenCalledWith(GUILD_ID);
	});

	it("an already-member result for an id not yet in guildids does not open the DMs and lands once guildArrived fires", async () => {
		const posts = captureRequests(API + "/invites/abc", alreadyMember);
		const dms = {id: "@me", loadChannel: vi.fn(async () => {})};
		const guild = {id: GUILD_ID, loadChannel: vi.fn(async () => {})};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
			guildids: new Map([["@me", dms]]),
			lookingguild: undefined,
		});
		const loadGuild = vi
			.spyOn(localuser, "loadGuild")
			.mockImplementation((id) => (localuser.guildids.get(id) ?? localuser.guildids.get("@me")) as never);
		const embed = new Embed(
			{type: "invite", invite: {url: WELLKNOWN, code: "abc"}} as never,
			{channel: {guild: {localuser}}} as never,
		);
		embed.invcache = [
			{
				code: "abc",
				guild: {id: GUILD_ID, name: "Guild", member_count: 3, icon: null, banner: null},
				channel: {name: "general"},
			} as never,
			{cdn: WELLKNOWN + "/cdn", api: API},
		];
		const div = embed.generateHTML() as HTMLElement;
		document.body.append(div);
		const accept = div.querySelector("button.acceptinvbutton") as HTMLButtonElement;

		accept.click();
		await vi.waitFor(() => expect(posts).toHaveLength(1));
		await flush();

		expect(loadGuild, "must not call loadGuild while the guild id is unknown").not.toHaveBeenCalled();
		expect(dms.loadChannel, "must not bounce to the DMs").not.toHaveBeenCalled();

		localuser.guildids.set(GUILD_ID, guild);
		localuser.guildArrived(GUILD_ID);
		expect(loadGuild).toHaveBeenCalledWith(GUILD_ID);
		expect(guild.loadChannel, "lands in the guild once guildArrived fires").toHaveBeenCalledOnce();
	});

	it("joining by code when already a member of an id not yet in guildids waits for guildArrived instead of opening the DMs", async () => {
		let calls = 0;
		captureRequests(API + "/invites/abc", () =>
			calls++ === 0 ? alreadyMember() : Response.json({guild: {id: GUILD_ID}}),
		);
		const addForm = vi.spyOn(Options.prototype, "addForm");
		const dms = {id: "@me", loadChannel: vi.fn(async () => {})};
		const guild = {id: GUILD_ID, loadChannel: vi.fn(async () => {})};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
			guildids: new Map([["@me", dms]]),
			lookingguild: undefined,
		});
		const loadGuild = vi
			.spyOn(localuser, "loadGuild")
			.mockImplementation((id) => (localuser.guildids.get(id) ?? localuser.guildids.get("@me")) as never);
		localuser.createGuild();
		const joinSubmit = addForm.mock.calls[0][1] as (fields: object, sent: object) => Promise<void>;

		await joinSubmit({code: "abc"}, {});

		expect(loadGuild, "must not call loadGuild while the guild id is unknown").not.toHaveBeenCalled();
		expect(dms.loadChannel, "must not bounce to the DMs").not.toHaveBeenCalled();

		localuser.guildids.set(GUILD_ID, guild);
		localuser.guildArrived(GUILD_ID);
		expect(loadGuild).toHaveBeenCalledWith(GUILD_ID);
		expect(guild.loadChannel, "lands in the guild once guildArrived fires").toHaveBeenCalledOnce();
	});

	it("the embed's accept disables on click and re-enables on a refusal", async () => {
		let resolvePost!: (res: Response) => void;
		captureRequests(
			API + "/invites/abc",
			() =>
				new Promise<Response>((resolve) => {
					resolvePost = resolve;
				}),
		);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
			guildids: new Map(),
		});
		const embed = new Embed(
			{type: "invite", invite: {url: WELLKNOWN, code: "abc"}} as never,
			{channel: {guild: {localuser}}} as never,
		);
		embed.invcache = [
			{
				code: "abc",
				guild: {id: GUILD_ID, name: "Guild", member_count: 3, icon: null, banner: null},
				channel: {name: "general"},
			} as never,
			{cdn: WELLKNOWN + "/cdn", api: API},
		];
		const div = embed.generateHTML() as HTMLElement;
		document.body.append(div);
		const accept = div.querySelector("button.acceptinvbutton") as HTMLButtonElement;

		accept.click();
		expect(accept.disabled).toBe(true);
		await vi.waitFor(() => expect(resolvePost).toBeTypeOf("function"));
		resolvePost(Response.json({message: "Invite expired"}, {status: 404}));
		await vi.waitFor(() => expect(alert).toHaveBeenCalledWith("Invite expired"));
		expect(accept.disabled).toBe(false);
	});

	it("joining by a code already a member of resolves as success, not a form error", async () => {
		captureRequests(API + "/invites/abc", alreadyMember);
		const hide = vi.spyOn(Dialog.prototype, "hide");
		const addForm = vi.spyOn(Options.prototype, "addForm");
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
		});
		// createGuild builds the "join using a code" tab first: its form is the first addForm.
		localuser.createGuild();
		const joinSubmit = addForm.mock.calls[0][1] as (fields: object, sent: object) => Promise<void>;

		// A FormError here is what the dialog shows as the failure.
		await expect(joinSubmit({code: "abc"}, {})).resolves.toBeUndefined();
		expect(hide).toHaveBeenCalled();
	});

	it("joining by a code with no network shows the failure in the form, instead of nothing", async () => {
		const err = new TypeError("Failed to fetch");
		captureRequests(API + "/invites/abc", () => Promise.reject(err));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const hide = vi.spyOn(Dialog.prototype, "hide");
		const addForm = vi.spyOn(Options.prototype, "addForm");
		const addTextInput = vi.spyOn(Form.prototype, "addTextInput");
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
		});
		localuser.createGuild();
		const joinSubmit = addForm.mock.calls[0][1] as (fields: object, sent: object) => Promise<void>;
		const codeInput = addTextInput.mock.results.find((_, i) => addTextInput.mock.calls[i][1] === "code")
			?.value;

		// The form shows a FormError inline, on the field it names; anything else it drops without a word.
		const failure = await joinSubmit({code: "abc"}, {}).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(FormError);
		expect((failure as InstanceType<typeof FormError>).message).toBe(I18n.requestFailed("offline"));
		expect(codeInput).toBeDefined();
		expect((failure as InstanceType<typeof FormError>).elem).toBe(codeInput);
		expect(errorSpy).toHaveBeenCalledWith(err);
		expect(hide).not.toHaveBeenCalled();
	});

	it("the embed's accept re-enables and alerts when the fetch rejects", async () => {
		const err = new TypeError("offline");
		const posts = captureRequests(API + "/invites/abc", () => Promise.reject(err));
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			info: {api: API, wellknown: WELLKNOWN},
			headers: {Authorization: "tok"},
			guildids: new Map(),
		});
		const embed = new Embed(
			{type: "invite", invite: {url: WELLKNOWN, code: "abc"}} as never,
			{channel: {guild: {localuser}}} as never,
		);
		embed.invcache = [
			{
				code: "abc",
				guild: {id: GUILD_ID, name: "Guild", member_count: 3, icon: null, banner: null},
				channel: {name: "general"},
			} as never,
			{cdn: WELLKNOWN + "/cdn", api: API},
		];
		const div = embed.generateHTML() as HTMLElement;
		document.body.append(div);
		const accept = div.querySelector("button.acceptinvbutton") as HTMLButtonElement;

		accept.click();
		await vi.waitFor(() => expect(posts).toHaveLength(1));
		await flush();

		expect(accept.disabled).toBe(false);
		expect(alert).toHaveBeenCalledWith(I18n.requestFailed("offline"));
		expect(errorSpy).toHaveBeenCalledWith(err);
	});

	it("a throw inside openJoinedGuild after a successful accept does not alert a network failure", async () => {
		const posts = captureRequests(API + "/invites/abc", () =>
			Response.json({guild: {id: GUILD_ID}}),
		);
		const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
		const onRejection = (e: PromiseRejectionEvent) => e.preventDefault();
		window.addEventListener("unhandledrejection", onRejection);
		try {
			const localuser = Object.assign(Object.create(Localuser.prototype), {
				info: {api: API, wellknown: WELLKNOWN},
				headers: {Authorization: "tok"},
				guildids: new Map(),
			});
			const openJoinedGuild = vi.spyOn(localuser, "openJoinedGuild").mockImplementation(() => {
				throw new Error("landing boom");
			});
			const embed = new Embed(
				{type: "invite", invite: {url: WELLKNOWN, code: "abc"}} as never,
				{channel: {guild: {localuser}}} as never,
			);
			embed.invcache = [
				{
					code: "abc",
					guild: {id: GUILD_ID, name: "Guild", member_count: 3, icon: null, banner: null},
					channel: {name: "general"},
				} as never,
				{cdn: WELLKNOWN + "/cdn", api: API},
			];
			const div = embed.generateHTML() as HTMLElement;
			document.body.append(div);
			const accept = div.querySelector("button.acceptinvbutton") as HTMLButtonElement;

			accept.click();
			await vi.waitFor(() => expect(posts).toHaveLength(1));
			await flush();

			expect(openJoinedGuild).toHaveBeenCalledWith(GUILD_ID);
			expect(alert).not.toHaveBeenCalledWith(I18n.requestFailed("offline"));
		} finally {
			window.removeEventListener("unhandledrejection", onRejection);
		}
	});
});
