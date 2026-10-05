import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

function userWithNoDm(goToChannel: (id: string) => Promise<void>, channelids = new Map()) {
	return Object.assign(Object.create(User.prototype), {
		id: "u2",
		owner: {
			info: {api: "http://dm.test/api/v9"},
			headers: {},
			guildids: new Map([["@me", {channels: []}]]),
			channelids,
			goToChannel,
		},
	}) as InstanceType<typeof User>;
}

it("a refused DM says so instead of waiting forever for a channel that doesn't exist", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "Cannot send messages to this user", code: 50007}, {status: 403}),
	);
	const goTo = vi.fn(async () => {});
	const user = userWithNoDm(goTo);

	await user.opendm("hi");

	expect(goTo).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 403"));
});

it("an unreachable instance says so too", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	const goTo = vi.fn(async () => {});

	await userWithNoDm(goTo).opendm();

	expect(goTo).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("the typed message goes to the DM the server created, found by its id", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({id: "dm9", type: 1}));
	const sendMessage = vi.fn();
	const channelids = new Map();
	// Only in channelids: the lookup is by the created id, not a recipient scan of @me.
	const goTo = vi.fn(async (id: string) => {
		channelids.set(id, {id, type: 1, users: [{id: "u2"}], sendMessage});
	});

	await userWithNoDm(goTo, channelids).opendm("hi");

	expect(sendMessage).toHaveBeenCalledWith("hi", expect.objectContaining({replyingto: null}));
});

// A regression pin for the success path (passes before the fix too).
it("a new DM opens, then gets the typed message", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({id: "dm9", type: 1}));
	const sendMessage = vi.fn();
	const channelids = new Map();
	// goToChannel resolves once CHANNEL_CREATE has added the DM to @me and channelids.
	const goTo = vi.fn(async (id: string) => {
		const dm = {id, type: 1, users: [{id: "u2"}], sendMessage};
		channelids.set(id, dm);
		user.localuser.guildids.get("@me")!.channels.push(dm as never);
	});
	const user = userWithNoDm(goTo, channelids);

	await user.opendm("hi");

	expect(goTo).toHaveBeenCalledWith("dm9");
	expect(sendMessage).toHaveBeenCalledWith("hi", expect.objectContaining({replyingto: null}));
});
