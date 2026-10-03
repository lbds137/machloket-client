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
