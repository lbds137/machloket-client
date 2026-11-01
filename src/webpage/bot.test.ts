import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Bot} = await import("./bot");
const {User} = await import("./user");
const {makeBotOwner} = await import("./test/botOwner");

const API = "http://bot.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

// Bot used to take its user as `mainuserjson` and re-wrap it (`new User(this.json, …)` in
// settings()) — the caller passed a real User behind an unknown-cast, so the "json" round
// tripped back through checkuser/userupdate. It now holds the User it is given and drives
// settings() off that instance; this pin holds that contract so the wrap cannot quietly
// return.
it("Bot holds the caller's User instead of re-wrapping it", async () => {
	captureRequests(API + "/users/@me/guilds/", () => Response.json([]));
	vi.spyOn(User.prototype, "buildprofile").mockResolvedValue(document.createElement("div"));
	const owner = await makeBotOwner(API);
	const bot = new User(
		{
			id: "9001",
			username: "botty",
			discriminator: "0001",
			avatar: null,
			bot: true,
			public_flags: 0,
			badge_ids: [],
			accent_color: 0,
			bio: "",
			premium_type: 0,
			premium_since: "",
			theme_colors: null,
		},
		owner,
		true,
	);
	const clone = vi.spyOn(bot, "clone");
	const botc = new Bot(bot, "token", owner);
	expect(botc.user).toBe(bot);

	botc.settings();
	expect(clone).toHaveBeenCalledOnce();
	expect(clone.mock.instances[0]).toBe(bot);
});
