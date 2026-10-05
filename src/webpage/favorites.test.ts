import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as guildCommands.test.ts.
await import("./localuser");
const {Favorites} = await import("./favorites.js");

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
