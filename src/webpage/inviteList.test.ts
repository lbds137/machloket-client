import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {makeInviteMenu} = await import("./guild");
const {Settings} = await import("./settings");
const {User} = await import("./user");
const {I18n} = await import("./i18n");
await I18n.done;

const URL_ = "http://invites.test/api/v9/guilds/g1/invites";
const initialLang = I18n.lang;

afterEach(() => {
	I18n.lang = initialLang;
	vi.restoreAllMocks();
});

/** An invite as the server lists it; one made by no one (a system invite) has no `inviter`. */
function invite(code: string, inviter?: object) {
	return {
		code,
		uses: 0,
		max_uses: 0,
		created_at: "2026-10-04T00:00:00Z",
		expires_at: null,
		channel_id: "c1",
		...(inviter ? {inviter} : {}),
	};
}

async function openInvite(inv: object) {
	captureRequests(URL_, () => Response.json([inv]));
	const menu = new Settings("").addButton("invites");
	const areas = vi.spyOn(menu, "addHTMLArea");
	// The inviter's card needs a whole account behind it; the menu only places it.
	const widget = vi
		.spyOn(User.prototype, "createWidget")
		.mockReturnValue(document.createElement("div"));
	const guild = {
		id: "g1",
		headers: {},
		channels: [{id: "c1", name: "general"}],
		info: {wellknown: "http://invites.test"},
		localuser: {userMap: new Map(), guilds: []},
	};
	await makeInviteMenu(menu, guild as never, URL_);
	const grid = areas.mock.calls[0][0] as HTMLElement;
	await vi.waitFor(() => expect(grid.querySelector(".inviteCard")).not.toBeNull());
	const card = grid.querySelector(".inviteCard") as HTMLElement;
	return {open: () => card.onclick!(new PointerEvent("click")), widget, card, menu};
}

it("an invite in Discord's list shape (a channel object, no channel_id) names its channel", async () => {
	const {channel_id: _, ...rest} = invite("dsc");
	const {card} = await openInvite({...rest, channel: {id: "c1", name: "general", type: 0}});

	expect(card.querySelector(".inviteChannel")?.textContent).toBe("#general");
});

it("an invite with no inviter opens its details, without a creator", async () => {
	const {open, widget} = await openInvite(invite("sys"));
	expect(open).not.toThrow();
	expect(widget).not.toHaveBeenCalled();
});

it("an invite with an inviter opens its details, showing its creator (the control)", async () => {
	const {open, widget} = await openInvite(
		invite("usr", {id: "u1", username: "alice", discriminator: "0"}),
	);
	expect(open).not.toThrow();
	expect(widget).toHaveBeenCalledTimes(1);
});

it("an invite's details format created_at and expires_at with I18n.locale", async () => {
	vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
	I18n.lang = "en";
	const {open, menu} = await openInvite({
		...invite("exp"),
		expires_at: "2026-11-05T00:00:00Z",
	});

	open();
	const details = menu.generateHTML();
	const texts = [...details.querySelectorAll(".optionElement > span")].map((s) => s.textContent);

	expect(texts).toContain(
		I18n.invite.createdAt(new Date("2026-10-04T00:00:00Z").toLocaleDateString("en-GB")),
	);
	expect(texts).toContain(
		I18n.invite.expires(new Date("2026-11-05T00:00:00Z").toLocaleDateString("en-GB")),
	);
});
