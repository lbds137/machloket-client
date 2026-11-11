import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
const {Localuser} = await import("./localuser");

it("a fresh identify ends the old call while its channel can still be found", async () => {
	// The call's status handler finds the call's channel among the guilds to clear the voice
	// panel; once READY empties them, the panel would keep showing a call that has ended.
	let guildsAtTeardown: number | undefined;
	const user = Object.assign(Object.create(Localuser.prototype), {
		guilds: [{}],
		channelids: new Map(),
		inrelation: new Set(),
		userMap: new Map(),
		info: {api: "https://inst.test/api/v9"},
		swapped: true,
		keepWaitingFiles: () => {},
		mdBox: () => {},
		voiceFactory: {
			teardown: vi.fn(() => {
				guildsAtTeardown = user.guilds.length;
			}),
		},
	});
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));

	// Only the start of READY matters here; what follows needs a whole session.
	await user
		.gottenReady({d: {user_settings: {guild_folders: []}, user: {id: "me", username: "me"}}})
		.catch(() => {});

	expect(guildsAtTeardown).toBe(1);
	vi.restoreAllMocks();
});
