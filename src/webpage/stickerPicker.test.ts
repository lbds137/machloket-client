import {afterEach, describe, expect, it, vi} from "vitest";
import type {freq} from "./jsontypes.js";

await import("./localuser");
const {Localuser} = await import("./localuser.js");
const {Guild} = await import("./guild.js");
const {Sticker} = await import("./sticker.js");
const {Favorites} = await import("./favorites.js");
const {Contextmenu} = await import("./contextmenu.js");
const {I18n} = await import("./i18n.js");
await I18n.done;

function makeFavorites(sticker_frecency: Record<string, freq> = {}) {
	return Object.assign(Object.create(Favorites.prototype), {
		owner: {
			info: {api: "http://sticker.test/api/v9", cdn: "http://sticker.test"},
			headers: {},
			perminfo: {favoriteStore: {}},
		},
		sticker_frecency,
	}) as InstanceType<typeof Favorites>;
}

function makeUser(sticker_frecency: Record<string, freq> = {}) {
	const favorites = makeFavorites(sticker_frecency);
	const user = Object.assign(Object.create(Localuser.prototype), {
		info: {api: "http://sticker.test/api/v9", cdn: "http://sticker.test"},
		headers: {},
		guilds: [],
		lookingguild: undefined,
		favorites,
		channelfocus: undefined,
	}) as InstanceType<typeof Localuser>;
	favorites.owner = user;
	return user;
}

function makeGuild(
	owner: InstanceType<typeof Localuser>,
	id: string,
	name: string,
	stickerIds: string[],
) {
	const guild = Object.assign(Object.create(Guild.prototype), {
		id,
		owner,
		properties: {id, name, icon: ""},
		stickers: [] as InstanceType<typeof Sticker>[],
	}) as InstanceType<typeof Guild>;
	guild.stickers = stickerIds.map(
		(sid) =>
			new Sticker(
				{
					id: sid,
					name: `sticker-${sid}`,
					description: `desc-${sid}`,
					tags: "🔥",
					type: 2,
					format_type: 1,
				},
				guild,
			),
	);
	return guild;
}

function freqEntry(score: number): freq {
	return {
		totalUses: Math.max(1, Math.floor(score / 100)),
		recentUses: [String(Date.now())],
		frecency: -1,
		score,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	Contextmenu.declareMenu();
	document.querySelectorAll(".stickerPicker").forEach((el) => el.remove());
});

describe("Sticker.stickerPicker", () => {
	it("renders Frequently Used section before guild sections in score order, skips unresolvable ids, and enforces the 10-sticker cap", () => {
		const user = makeUser({
			"deleted-server-side": freqEntry(9999),
			s11: freqEntry(1200),
			s3: freqEntry(1100),
			s1: freqEntry(1000),
			s2: freqEntry(900),
			s4: freqEntry(800),
			s5: freqEntry(700),
			s6: freqEntry(600),
			s7: freqEntry(500),
			s8: freqEntry(400),
			s9: freqEntry(300),
			s10: freqEntry(200),
			s12: freqEntry(100),
		});
		const g1 = makeGuild(
			user,
			"g1",
			"Guild One",
			["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
		);
		const g2 = makeGuild(user, "g2", "Guild Two", ["s11", "s12"]);
		user.guilds = [g1, g2];
		user.lookingguild = g1;

		void Sticker.stickerPicker(10, 10, user);
		const picker = document.querySelector(".stickerPicker")!;
		expect(picker).not.toBeNull();

		const railItems = Array.from(picker.querySelectorAll(".emojirow > div"));
		expect(railItems).toHaveLength(3);
		expect(railItems[0]!.classList.contains("svg-history")).toBe(true);
		expect(railItems[1]!.classList.contains("emojiSelect")).toBe(true);
		expect(railItems[2]!.classList.contains("emojiSelect")).toBe(true);

		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(
			I18n.sticker.frequentlyUsed(),
		);

		const imgs = Array.from(
			picker.querySelectorAll<HTMLImageElement>(".stickerBody .stickerSelect img.sticker"),
		);
		expect(imgs).toHaveLength(10);
		expect(imgs.map((img) => img.alt)).toEqual([
			"desc-s11",
			"desc-s3",
			"desc-s1",
			"desc-s2",
			"desc-s4",
			"desc-s5",
			"desc-s6",
			"desc-s7",
			"desc-s8",
			"desc-s9",
		]);

		// Clicking a guild rail item switches to that guild section; clicking history switches back.
		railItems[1]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe("Guild One");
		expect(picker.querySelectorAll(".stickerBody .stickerSelect")).toHaveLength(10);

		railItems[0]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe(
			I18n.sticker.frequentlyUsed(),
		);
	});

	it("omits Frequently Used section when all frecency ids are unresolvable and opens on the first guild", () => {
		const user = makeUser({
			"deleted-1": freqEntry(500),
			"deleted-2": freqEntry(300),
		});
		const g1 = makeGuild(user, "g1", "Guild One", ["s1", "s2"]);
		user.guilds = [g1];
		user.lookingguild = g1;

		void Sticker.stickerPicker(10, 10, user);
		const picker = document.querySelector(".stickerPicker")!;
		expect(picker.querySelector(".emojirow .svg-history")).toBeNull();
		expect(picker.querySelector(".emojiTitle")?.textContent).toBe("Guild One");
		expect(picker.querySelectorAll(".stickerBody .stickerSelect")).toHaveLength(2);
	});

	it("resolves the home guild's Sticker on pick from both Frequently Used and a guild section", async () => {
		const user = makeUser({
			s11: freqEntry(300),
			s1: freqEntry(100),
		});
		const g1 = makeGuild(user, "g1", "Guild One", ["s1"]);
		const g2 = makeGuild(user, "g2", "Guild Two", ["s11"]);
		user.guilds = [g1, g2];
		user.lookingguild = g1;

		const pickFreqPromise = Sticker.stickerPicker(10, 10, user);
		const picker1 = document.querySelector(".stickerPicker")!;
		const freqRows = picker1.querySelectorAll(".stickerBody .stickerSelect");
		expect(freqRows).toHaveLength(2);
		freqRows[0]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		const pickedFromFreq = await pickFreqPromise;
		expect(pickedFromFreq).toBe(g2.stickers[0]);
		expect(pickedFromFreq?.owner).toBe(g2);
		picker1.remove();

		const pickGuildPromise = Sticker.stickerPicker(10, 10, user);
		const picker2 = document.querySelector(".stickerPicker")!;
		const guildRail = picker2.querySelectorAll(".emojirow .emojiSelect")[0]!;
		guildRail.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		const guildRows = picker2.querySelectorAll(".stickerBody .stickerSelect");
		expect(guildRows).toHaveLength(1);
		guildRows[0]!.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		const pickedFromGuild = await pickGuildPromise;
		expect(pickedFromGuild).toBe(g1.stickers[0]);
		expect(pickedFromGuild?.owner).toBe(g1);
	});

	it("resolves undefined when the empty-state picker closes without a pick", async () => {
		const user = makeUser();
		const pending = Sticker.stickerPicker(10, 10, user);

		const picker = document.querySelector(".stickerPicker")!;
		expect(picker).not.toBeNull();
		expect(picker.querySelector("h2")?.textContent).toBe(I18n.noStickers());

		Contextmenu.declareMenu();

		const outcome = await Promise.race([
			pending,
			new Promise<"TIMED_OUT">((r) => setTimeout(() => r("TIMED_OUT"), 100)),
		]);
		expect(outcome).toBeUndefined();
	});

	it("resolves undefined when a populated picker closes without a pick, and makeStickerBox skips send and addStickerFreq", async () => {
		const user = makeUser();
		const g1 = makeGuild(user, "g1", "Guild One", ["s1"]);
		user.guilds = [g1];
		user.lookingguild = g1;
		const addStickerFreq = vi.spyOn(user.favorites, "addStickerFreq").mockResolvedValue();
		const sendMessage = vi.fn();
		user.channelfocus = {
			sendMessage,
			replyingto: null,
		} as never;

		const boxPromise = user.makeStickerBox(new DOMRect(100, 100, 20, 20));
		const picker = document.querySelector(".stickerPicker")!;
		expect(picker).not.toBeNull();

		// Outside click closes the picker via Contextmenu's closeIfOutside listener.
		document.body.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		const outcome = await Promise.race([
			boxPromise,
			new Promise<"TIMED_OUT">((r) => setTimeout(() => r("TIMED_OUT"), 100)),
		]);
		expect(outcome).toBeUndefined();
		expect(addStickerFreq).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("getFromId skips guilds that never assigned stickers (the @me home is a Direct) instead of throwing", () => {
		const user = makeUser();
		// The Direct (@me home) extends Guild but its constructor receives no guildjson, so
		// `stickers` stays undefined on it — every sticker send died in getFromId before the
		// request left (undefined.find), which the send-flow pins above now guard against.
		const broken = {id: "broken", stickers: undefined} as unknown as InstanceType<typeof Guild>;
		const g1 = makeGuild(user, "g1", "Guild One", ["s1"]);
		user.guilds = [broken, g1];

		expect(() => Sticker.getFromId("s1", user)).not.toThrow();
		expect(Sticker.getFromId("s1", user)).toBe(g1.stickers[0]);
		expect(Sticker.getFromId("missing", user)).toBeUndefined();
	});
});
