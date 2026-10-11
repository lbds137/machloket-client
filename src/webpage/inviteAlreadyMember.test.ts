import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Embed} = await import("./embed");
const {Dialog, Options} = await import("./settings");

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
		// The guild is not in guildids yet (the list hasn't loaded), so the disabled-button
		// guard misses it and the accept stays live, as in the bug.
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

		accept.click();
		await vi.waitFor(() => expect(posts).toHaveLength(1));
		await flush();

		// The refusal is a success here: no alert, and the guild is opened.
		expect(alert).not.toHaveBeenCalled();
		expect(loadGuild).toHaveBeenCalledWith(GUILD_ID);
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
});
