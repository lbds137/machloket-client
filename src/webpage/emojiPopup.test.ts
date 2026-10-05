import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {Emoji} = await import("./emoji");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll(".EmojiGuildMenu").forEach((e) => e.remove());
});

describe("tapping a custom emoji", () => {
	it("from a server you can't see still opens its card, marked private", async () => {
		vi.spyOn(Emoji, "lookupEmoji").mockResolvedValue(undefined);
		const owner = {info: {cdn: "http://cdn.test", api: "http://api.test"}, headers: {}};
		const emoji = new Emoji({id: "900", name: "partyblob"}, owner as never);
		const img = emoji.getHTML();
		document.body.append(img);

		img.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX: 10, clientY: 10}));

		await vi.waitFor(() => {
			const card = document.querySelector(".EmojiGuildMenu");
			expect(card?.textContent).toContain(I18n.emoji.found.private());
		});
		img.remove();
	});
});

describe("looking up a custom emoji's server", () => {
	const source = {type: "GUILD", guild: {id: "77", name: "Blobs", features: []}};
	const localuser = () => ({guilds: [], info: {api: "http://api.test"}, headers: {}}) as never;

	it("a passing failure isn't remembered: the next tap asks again", async () => {
		const user = localuser();
		const fetched = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({message: "rate limited"}, {status: 429}))
			.mockResolvedValueOnce(Response.json(source));

		expect(await Emoji.lookupEmoji("900", user)).toBeUndefined();
		expect(await Emoji.lookupEmoji("900", user)).toEqual(source);
		expect(fetched).toHaveBeenCalledTimes(2);
	});

	it("an unreachable instance reads as unknown rather than throwing", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

		await expect(Emoji.lookupEmoji("901", localuser())).resolves.toBeUndefined();
	});

	it("an emoji the instance doesn't know is remembered as unknown", async () => {
		const user = localuser();
		const fetched = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({code: 10014, message: "Unknown Emoji"}, {status: 404}));

		expect(await Emoji.lookupEmoji("903", user)).toBeUndefined();
		expect(await Emoji.lookupEmoji("903", user)).toBeUndefined();
		expect(fetched).toHaveBeenCalledTimes(1);
	});

	it("a found source is remembered", async () => {
		const user = localuser();
		const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(source));

		await Emoji.lookupEmoji("902", user);
		expect(await Emoji.lookupEmoji("902", user)).toEqual(source);
		expect(fetched).toHaveBeenCalledTimes(1);
	});
});

describe("an emoji named by a favourite or a reaction", () => {
	const localuser = {guilds: []} as never;

	it("an emoji the list doesn't know stays that emoji, not a server emoji with it as an id", () => {
		const emoji = Emoji.getEmojiFromIDOrString("🫨‍↔️", localuser);

		expect(emoji.id).toBeUndefined();
		expect(emoji.emoji).toBe("🫨‍↔️");
	});

	it("an id no loaded server has is still a server emoji", () => {
		expect(Emoji.getEmojiFromIDOrString("1553128655016763450", localuser).id).toBe(
			"1553128655016763450",
		);
	});

	it("can be looked up before the emoji list has loaded", async () => {
		// A fresh copy of the module: its list is still loading.
		vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
		const fresh = "./emoji.ts?listLoading=" + Date.now();
		const {Emoji: Fresh} = (await import(/* @vite-ignore */ fresh)) as typeof import("./emoji");

		expect(() => Fresh.getEmojiFromIDOrString("😀", localuser)).not.toThrow();
	});
});
