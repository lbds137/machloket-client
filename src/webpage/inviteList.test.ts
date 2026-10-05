import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {makeInviteMenu} = await import("./guild");
const {Settings} = await import("./settings");
const {User} = await import("./user");

const URL_ = "http://invites.test/api/v9/guilds/g1/invites";

afterEach(() => {
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
		channels: [],
		info: {wellknown: "http://invites.test"},
		localuser: {userMap: new Map(), guilds: []},
	};
	await makeInviteMenu(menu, guild as never, URL_);
	const grid = areas.mock.calls[0][0] as HTMLElement;
	await vi.waitFor(() => expect(grid.querySelector(".inviteCard")).not.toBeNull());
	const card = grid.querySelector(".inviteCard") as HTMLElement;
	return {open: () => card.onclick!(new PointerEvent("click")), widget};
}

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
