import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Bot} = await import("./bot");
const {User} = await import("./user");
const {makeBotOwner} = await import("./test/botOwner");

// Bot used to take its user as `mainuserjson` and re-wrap it (`new User(this.json, …)` in
// settings()) — the caller passed a real User behind an unknown-cast, so the "json" round
// tripped back through checkuser/userupdate. It now holds the User it is given; this pin
// holds that contract so the wrap cannot quietly return.
it("Bot holds the caller's User instead of re-wrapping it", async () => {
	const owner = await makeBotOwner("http://bot.test/api/v9");
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
	const botc = new Bot(bot, "token", owner);
	expect(botc.user).toBe(bot);
});
