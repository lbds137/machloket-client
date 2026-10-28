import {afterEach, describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as guildCommands.test.ts.
await import("./localuser");
const {Favorites} = await import("./favorites.js");
const {Emoji} = await import("./emoji.js");
const {I18n} = await import("./i18n.js");
await I18n.done;

const API_ROOT = "http://fav.test";
const SYNC_URL = API_ROOT + "/users/@me/settings-proto/2/json";

/** A Favorites with only what startSync and saveDifs read (same Object.create pattern as
 * guildCommands.test.ts). The store matches what loadFromLocal guarantees before startSync
 * runs; lastDecay is "now" so decayScore's 12h gate skips its save path. */
function favoritesWithStore() {
	const old = {
		favoriteGifs: {gifs: {}, hideTooltip: false},
		emojiFrecency: {emojis: {}},
		emojiReactionFrecency: {emojis: {}},
		guildAndChannelFrecency: {guildAndChannels: {}},
		favorite_stickers: {sticker_ids: []},
		sticker_frecency: {stickers: {}},
		favorite_emojis: {emojis: []},
	};
	const store = {
		current: {
			gifs: {},
			emojiFrecency: {},
			emojiReactionFrecency: {},
			guildAndChannelFrecency: {},
			favorite_stickers: [],
			sticker_frecency: {},
			favorite_emojis: [],
		},
		needsSave: 0,
		lastSave: 0,
		lastDecay: Date.now(),
		old,
	};
	return Object.assign(Object.create(Favorites.prototype), {
		owner: {info: {api: API_ROOT}, headers: {}, perminfo: {favoriteStore: store}},
		emojiReactionFrecency: {},
		emojiFrecency: {},
		gifs: {},
		guildAndChannelFrecency: {},
		sticker_frecency: {},
		favorite_stickers: [],
		favorite_emojis: [],
		needsSave: 0,
		lastSave: 0,
		lastDecay: Date.now(),
		old,
	}) as InstanceType<typeof Favorites>;
}

describe("favorites startSync", () => {
	it("the fork's empty-map shape (emojiReactionFrecency {} with no emojis) syncs without throwing", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () => Response.json({settings: {emojiReactionFrecency: {}}}));
		await favorites.startSync();
		expect(favorites.emojiReactFreq()).toEqual([]);
	});

	it("a null emojis map syncs without throwing", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () =>
			Response.json({settings: {emojiReactionFrecency: {emojis: null}}}),
		);
		await favorites.startSync();
		expect(favorites.emojiReactFreq()).toEqual([]);
	});

	it("a null settings object syncs without throwing", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () => Response.json({settings: null}));
		await favorites.startSync();
		expect(favorites.emojiReactFreq()).toEqual([]);
	});

	it("real frecency data still flows through sync", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () =>
			Response.json({
				settings: {
					emojiReactionFrecency: {
						emojis: {
							probeemoji: {totalUses: 1, recentUses: ["1760000000000"], frecency: -1, score: 100},
						},
					},
				},
			}),
		);
		await favorites.startSync();
		expect(favorites.emojiReactFreq()).toEqual([["probeemoji", expect.objectContaining({score: 100})]]);
	});
});

describe("favorites merge with the server", () => {
	it("a favorite added locally survives a sync (ids, not array indexes, are compared)", () => {
		const favorites = favoritesWithStore() as unknown as {
			old: {favorite_emojis: {emojis: string[]}};
			favorite_emojis: string[];
			saveDifs: (diffs: object, save?: boolean) => void;
			getFavoriteEmojis: () => string[];
		};
		favorites.old.favorite_emojis.emojis = ["a", "b"];
		favorites.favorite_emojis = ["a", "b", "c"];

		favorites.saveDifs({favorite_emojis: {emojis: ["a", "b"]}}, false);

		expect(favorites.favorite_emojis).toEqual(["a", "b", "c"]);
	});
});

describe("favorites on reload", () => {
	it("keeps the saved favorite emojis and stickers (the next sync would read them as removed)", () => {
		const favorites = favoritesWithStore() as unknown as {
			owner: {perminfo: {favoriteStore: {current: {favorite_emojis: string[]; favorite_stickers: string[]}}}};
			loadFromLocal: () => void;
			favorite_emojis: string[];
			favorite_stickers: string[];
		};
		const store = favorites.owner.perminfo.favoriteStore;
		store.current.favorite_emojis = ["e1"];
		store.current.favorite_stickers = ["s1"];

		favorites.loadFromLocal();

		expect(favorites.favorite_emojis).toEqual(["e1"]);
		expect(favorites.favorite_stickers).toEqual(["s1"]);
	});
});

describe("favorites edits", () => {
	it("favouriting the same emoji or sticker twice keeps one", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () => Response.json({settings: {}}));

		await favorites.favoriteEmoji("🦊");
		await favorites.favoriteEmoji("🦊");
		await favorites.favoriteSticker("700");
		await favorites.favoriteSticker("700");

		expect(favorites.favoriteEmojis().filter((e) => e === "🦊")).toHaveLength(1);
		const stickers = (favorites as unknown as {favorite_stickers: string[]}).favorite_stickers;
		expect(stickers.filter((s) => s === "700")).toHaveLength(1);
	});

	it("a gif favourited after a removal takes a new place, not a kept one's", async () => {
		const favorites = favoritesWithStore();
		captureRequests(SYNC_URL, () => Response.json({settings: {}}));
		const gif = {src: "s", width: 1, height: 1};

		await favorites.favoriteGif("a", gif);
		await favorites.favoriteGif("b", gif);
		await favorites.removeFavoriteGif("a");
		await favorites.favoriteGif("c", gif);

		const gifs = (favorites as unknown as {gifs: Record<string, {order: number}>}).gifs;
		const orders = Object.values(gifs).map((g) => g.order);
		expect(new Set(orders).size).toBe(orders.length);
	});

	it("a save that can't read the server's favourites first doesn't overwrite them, and doesn't throw", async () => {
		const favorites = favoritesWithStore();
		let calls = 0;
		const written = captureRequests(SYNC_URL, () =>
			calls++ === 0 ? new Response("<html>bad gateway</html>", {status: 502}) : Response.json({}),
		);

		await expect(favorites.favoriteEmoji("🦊")).resolves.toBeUndefined();

		expect(written.filter((body) => body !== undefined)).toHaveLength(0);
	});
});

describe("favorites decay", () => {
	it("a large score decays to a smaller positive score", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {
			lastDecay: Date.now() - 48 * 3600 * 1000,
			emojiFrecency: {"🦊": {totalUses: 1, recentUses: [], frecency: 1, score: 3e9}},
		});

		await favorites.decayScore(false);

		const score = (favorites as unknown as {emojiFrecency: Record<string, {score: number}>})
			.emojiFrecency["🦊"].score;
		expect(score).toBeGreaterThan(0);
		expect(score).toBeLessThan(3e9);
	});

	it("an entry the server sent without a score decays to 0, not NaN", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {
			lastDecay: Date.now() - 48 * 3600 * 1000,
			emojiFrecency: {"🦊": {totalUses: 1, recentUses: [], frecency: 1}},
		});

		await favorites.decayScore(false);

		const fox = (favorites as unknown as {emojiFrecency: Record<string, {score: number}>})
			.emojiFrecency["🦊"];
		expect(fox.score).toBe(0);
	});

	it("sticker scores decay like emoji scores", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {
			lastDecay: Date.now() - 48 * 3600 * 1000,
			sticker_frecency: {"700": {totalUses: 1, recentUses: [], frecency: 1, score: 1000}},
		});

		await favorites.decayScore(false);

		const sticker = (favorites as unknown as {sticker_frecency: Record<string, {score: number}>})
			.sticker_frecency["700"];
		expect(sticker.score).toBeLessThan(1000);
	});
});

describe("emojiRecentsMerged and picker recents rail", () => {
	const savedEmojis = Emoji.emojis;

	afterEach(() => {
		Emoji.emojis = savedEmojis;
		document.querySelectorAll(".emojiPicker").forEach((e) => e.remove());
	});

	it("a reaction-only entry (no composer picks) appears in the merged accessor", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {lastSave: Date.now()});
		await favorites.addReactEmoji("🔥");

		expect(favorites.emojiRecentsMerged().map(([k]) => k)).toEqual(["🔥"]);
	});

	it("a composer-only entry appears and a key present in both maps sums its weight", () => {
		const favorites = favoritesWithStore();
		const now = Date.now();
		const oneHourAgo = String(now - 3600_000);
		const fiveDaysAgo = String(now - 5 * 86_400_000);

		Object.assign(favorites, {
			emojiFrecency: {
				"🚀": {totalUses: 2, recentUses: [oneHourAgo, fiveDaysAgo], frecency: -1, score: 200},
				"🎉": {totalUses: 1, recentUses: [oneHourAgo], frecency: -1, score: 100},
				"👍": {totalUses: 1, recentUses: [oneHourAgo], frecency: -1, score: 100},
			},
			emojiReactionFrecency: {
				"👍": {totalUses: 1, recentUses: [oneHourAgo], frecency: -1, score: 100},
			},
		});

		expect(favorites.emojiRecentsMerged().map(([k]) => k)).toEqual(["👍", "🚀", "🎉"]);
	});

	it("drops the >=15 gate: 1 entry yields a non-empty list, shows the recents rail, and opens on recents", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {lastSave: Date.now()});
		await favorites.addReactEmoji("🔥");

		expect(favorites.emojiRecentsMerged()).toHaveLength(1);

		Emoji.emojis = [{name: "Smileys", emojis: [{name: "grinning", emoji: "😀"}]}];
		const guild = {
			id: "g1",
			properties: {id: "g1", name: "Test Guild", icon: ""},
			emojis: [{id: "9001", name: "blob", animated: false}],
		};
		const localuser = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [guild],
			lookingguild: guild,
			favorites,
		};

		void Emoji.emojiPicker(10, 10, localuser as never);
		const picker = document.querySelector(".emojiPicker")!;

		expect(picker.querySelector(".emojirow .svg-history")).not.toBeNull();
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(I18n.recentEmoji());
	});

	it("preserves open priority when recents is empty: first guild section > first unicode category", () => {
		const favorites = favoritesWithStore();
		Emoji.emojis = [{name: "Smileys", emojis: [{name: "grinning", emoji: "😀"}]}];
		const guild = {
			id: "g1",
			properties: {id: "g1", name: "Test Guild", icon: ""},
			emojis: [{id: "9001", name: "blob", animated: false}],
		};
		const withGuild = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [guild],
			lookingguild: guild,
			favorites,
		};

		void Emoji.emojiPicker(10, 10, withGuild as never);
		const guildPicker = document.querySelector(".emojiPicker")!;
		expect(guildPicker.querySelector(".emojirow .svg-history")).toBeNull();
		expect(guildPicker.querySelector(".emojiTitle")?.textContent).toBe("Test Guild");
		guildPicker.remove();

		const withoutGuild = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [],
			lookingguild: undefined,
			favorites,
		};
		void Emoji.emojiPicker(10, 10, withoutGuild as never);
		const unicodePicker = document.querySelector(".emojiPicker")!;
		expect(unicodePicker.querySelector(".emojiTitle")?.textContent).toBe("Smileys");
	});

	it("decay ordering: equal use counts (~1h old vs ~30d old) rank newer first from a today-shaped storage blob", () => {
		const favorites = favoritesWithStore();
		const now = Date.now();
		const oneHourAgo = String(now - 3600_000);
		const twoHoursAgo = String(now - 7200_000);
		const thirtyDaysAgo = String(now - 30 * 86_400_000);
		const thirtyOneDaysAgo = String(now - 31 * 86_400_000);

		const store = (
			favorites as unknown as {
				owner: {perminfo: {favoriteStore: {current: {emojiFrecency: Record<string, unknown>}}}};
			}
		).owner.perminfo.favoriteStore;
		store.current.emojiFrecency = {
			"⏳": {
				totalUses: 2,
				recentUses: [thirtyDaysAgo, thirtyOneDaysAgo],
				frecency: -1,
				score: 200,
			},
			"⚡": {
				totalUses: 2,
				recentUses: [oneHourAgo, twoHoursAgo],
				frecency: -1,
				score: 200,
			},
		};

		favorites.loadFromLocal();

		expect(favorites.emojiRecentsMerged().map(([k]) => k)).toEqual(["⚡", "⏳"]);
	});

	it("entries whose uses are all older than 90 days drop from recents (zero weight)", () => {
		const favorites = favoritesWithStore();
		const now = Date.now();
		const hundredDaysAgo = String(now - 100 * 86_400_000);
		const eightyDaysAgo = String(now - 80 * 86_400_000);

		Object.assign(favorites, {
			emojiFrecency: {
				"🦕": {
					totalUses: 3,
					recentUses: [hundredDaysAgo, hundredDaysAgo, hundredDaysAgo],
					frecency: -1,
					score: 300,
				},
				"🌱": {
					totalUses: 1,
					recentUses: [eightyDaysAgo],
					frecency: -1,
					score: 100,
				},
				"🦖": {
					totalUses: 10,
					recentUses: [hundredDaysAgo],
					frecency: -1,
					score: 100,
				},
			},
		});

		expect(favorites.emojiRecentsMerged().map(([k]) => k)).toEqual(["🌱"]);
	});

	it("a future-stamped use clamps to full weight; equal weights tie-break by totalUses", () => {
		const favorites = favoritesWithStore();
		const now = Date.now();

		Object.assign(favorites, {
			emojiFrecency: {
				"⏩": {totalUses: 1, recentUses: [String(now + 60_000)], frecency: -1, score: 100},
				// Future-stamped too: both weights clamp to exactly 1, so the totalUses
				// tie-break decides deterministically (a now-stamped seed decays below 1
				// after one millisecond and the order flips on slow machines).
				"🗿": {totalUses: 5, recentUses: [String(now + 60_000)], frecency: -1, score: 500},
			},
		});

		const merged = favorites.emojiRecentsMerged();
		// Clock skew clamps to age 0: weight exactly 1.
		expect(merged.find(([k]) => k === "⏩")?.[1].weight).toBe(1);
		expect(merged.map(([k]) => k)).toEqual(["🗿", "⏩"]);
	});

	it("emojiReactFreq ranks by decay: a newer single-use entry outranks an older heavily-used one", () => {
		const favorites = favoritesWithStore();
		const now = Date.now();
		const oneHourAgo = String(now - 3600_000);
		const twentyDaysAgo = String(now - 20 * 86_400_000);

		Object.assign(favorites, {
			emojiReactionFrecency: {
				"🐇": {totalUses: 1, recentUses: [oneHourAgo], frecency: -1, score: 100},
				"🐢": {totalUses: 5, recentUses: [twentyDaysAgo], frecency: -1, score: 500},
			},
		});

		// Under the old lifetime-score sort, 🐢 (500) beat 🐇 (100); decay flips it.
		// The accessor feeds the hover quick-reaction bar (message.ts).
		expect(favorites.emojiReactFreq().map(([k]) => k)).toEqual(["🐇", "🐢"]);
	});

	it("a foreign custom emoji (id from a guild the user is not in) never reaches the rail", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {lastSave: Date.now()});
		// One reaction on someone else's custom emoji (bare snowflake id) plus a
		// normal unicode reaction.
		await favorites.addReactEmoji("999999999999999999");
		await favorites.addReactEmoji("🔥");

		Emoji.emojis = [{name: "Smileys", emojis: [{name: "grinning", emoji: "😀"}]}];
		const guild = {
			id: "g1",
			properties: {id: "g1", name: "Test Guild", icon: ""},
			emojis: [{id: "9001", name: "blob", animated: false}],
		};
		const localuser = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [guild],
			lookingguild: guild,
			favorites,
		};

		void Emoji.emojiPicker(10, 10, localuser as never);
		const picker = document.querySelector(".emojiPicker")!;
		// Only 🔥 renders; the unresolvable id must not become a nameless Emoji
		// on the rail (picking it would insert a broken `<::id>`).
		const rail = picker.querySelectorAll(".emojiBody .emojiSelect");
		expect(rail).toHaveLength(1);
		expect(rail[0]!.textContent).toBe("🔥");
	});

	it("a guild click does not steal the search-clear restore target (recents)", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {lastSave: Date.now()});
		await favorites.addReactEmoji("🔥");

		Emoji.emojis = [{name: "Smileys", emojis: [{name: "grinning", emoji: "😀"}]}];
		const guild = {
			id: "g1",
			properties: {id: "g1", name: "Test Guild", icon: ""},
			emojis: [{id: "9001", name: "blob", animated: false}],
		};
		const localuser = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [guild],
			lookingguild: guild,
			favorites,
		};

		void Emoji.emojiPicker(10, 10, localuser as never);
		const picker = document.querySelector(".emojiPicker")!;
		// Recents open first and sit first in the rail.
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(I18n.recentEmoji());

		// The first emojiSelect in the rail is now the guild's.
		const guildSelect = picker.querySelectorAll(".emojirow .emojiSelect")[0]!;
		guildSelect.dispatchEvent(new Event("click"));
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe("Test Guild");

		const search = picker.querySelector("input")!;
		search.value = "grinning";
		search.dispatchEvent(new Event("input"));
		search.value = "";
		search.dispatchEvent(new Event("input"));
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(I18n.recentEmoji());
	});

	it("clearing the search restores the section the picker opened on", async () => {
		const favorites = favoritesWithStore();
		Object.assign(favorites, {lastSave: Date.now()});
		await favorites.addReactEmoji("🔥");

		Emoji.emojis = [{name: "Smileys", emojis: [{name: "grinning", emoji: "😀"}]}];
		const guild = {
			id: "g1",
			properties: {id: "g1", name: "Test Guild", icon: ""},
			emojis: [{id: "9001", name: "blob", animated: false}],
		};
		const localuser = {
			info: {api: API_ROOT, cdn: "http://cdn.test"},
			headers: {},
			guilds: [guild],
			lookingguild: guild,
			favorites,
		};

		void Emoji.emojiPicker(10, 10, localuser as never);
		const picker = document.querySelector(".emojiPicker")!;
		const search = picker.querySelector("input")!;

		search.value = "grinning";
		search.dispatchEvent(new Event("input"));
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe("");

		search.value = "";
		search.dispatchEvent(new Event("input"));
		// Recents opened first (it exists), so the cleared search returns to it —
		// not to a stale result body under an empty title.
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(I18n.recentEmoji());
	});
});
