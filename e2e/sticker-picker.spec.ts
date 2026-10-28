import {expect} from "@playwright/test";
import type {stickerJson} from "../src/webpage/jsontypes";
import {
	expectRequests,
	loginAndOpenChannel,
	MOCK_CHANNEL_ID,
	MOCK_GUILD_ID,
	test,
} from "./fixtures";

const STICKER_ALPHA_ID = "1200000000000000801";
const STICKER_BETA_ID = "1200000000000000802";

const MOCK_STICKERS: stickerJson[] = [
	{
		id: STICKER_ALPHA_ID,
		name: "AlphaWave",
		description: "Alpha sticker",
		tags: "👋",
		type: 2,
		format_type: 1,
		guild_id: MOCK_GUILD_ID,
	},
	{
		id: STICKER_BETA_ID,
		name: "BetaSpark",
		description: "Beta sticker",
		tags: "✨",
		type: 2,
		format_type: 1,
		guild_id: MOCK_GUILD_ID,
	},
];

test.describe("populated guild stickers", () => {
	test.use({mockInstanceOptions: {stickers: MOCK_STICKERS}});

	test("opens with Frequently Used section in score order when frecency is seeded in userinfos storage", async ({
		page,
		mockInstance,
	}) => {
		// Seed via the app's own localStorage store (utils.ts getBulkInfo "userinfos" ->
		// users[currentuser].localuserStore.favoriteStore.current.sticker_frecency, read by
		// Favorites.loadFromLocal at favorites.ts:86,98,138) when /channels boots after login.
		await page.addInitScript(
			({alphaId, betaId}) => {
				if (!window.location.pathname.startsWith("/channels")) return;
				const raw = localStorage.getItem("userinfos");
				if (!raw) return;
				const info = JSON.parse(raw);
				const user = info.users?.[info.currentuser];
				if (!user) return;
				const now = String(Date.now());
				user.localuserStore ??= {};
				user.localuserStore.favoriteStore = {
					current: {
						sticker_frecency: {
							"999999999999999999": {totalUses: 9, recentUses: [now], frecency: -1, score: 900},
							[betaId]: {totalUses: 3, recentUses: [now], frecency: -1, score: 300},
							[alphaId]: {totalUses: 1, recentUses: [now], frecency: -1, score: 100},
						},
					},
					lastDecay: Date.now(),
					lastSave: Date.now(),
					needsSave: 0,
				};
				localStorage.setItem("userinfos", JSON.stringify(info));
			},
			{alphaId: STICKER_ALPHA_ID, betaId: STICKER_BETA_ID},
		);

		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		await page.locator("#stickerTB").click();
		const picker = page.locator(".stickerPicker");
		await expect(picker).toBeVisible();
		await expect(picker.locator(".emojiTitle")).toHaveText("Frequently Used");
		await expect(picker.locator(".emojirow > div").first()).toHaveClass(/svg-history/);

		const stickerImgs = picker.locator(".stickerBody .stickerSelect img.sticker");
		await expect(stickerImgs).toHaveCount(2);
		await expect(stickerImgs.nth(0)).toHaveAttribute("alt", "Beta sticker");
		await expect(stickerImgs.nth(1)).toHaveAttribute("alt", "Alpha sticker");
	});

	test("picking a sticker sends it and records frecency so subsequent opens show Frequently Used in score order", async ({
		page,
		mockInstance,
	}) => {
		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		const isMessageSend = (req: {method: string; pathname: string}) =>
			req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`;

		// First open: no frecency yet, so the picker opens on Mock Guild with no history rail icon.
		await page.locator("#stickerTB").click();
		const picker = page.locator(".stickerPicker");
		await expect(picker).toBeVisible();
		await expect(picker.locator(".emojiTitle")).toHaveText("Mock Guild");
		await expect(picker.locator(".emojirow .svg-history")).toHaveCount(0);

		// Pick Beta sticker (second sticker in Mock Guild).
		await picker.locator(".stickerBody .stickerSelect").nth(1).click();
		const firstSends = await expectRequests(mockInstance, isMessageSend, 1);
		expect((firstSends[0]!.body as {sticker_ids?: string[]}).sticker_ids).toEqual([
			STICKER_BETA_ID,
		]);
		await expect(picker).toBeHidden();

		// Second open: Beta is now in Frequently Used.
		await page.locator("#stickerTB").click();
		await expect(picker).toBeVisible();
		await expect(picker.locator(".emojiTitle")).toHaveText("Frequently Used");
		const secondOpenImgs = picker.locator(".stickerBody .stickerSelect img.sticker");
		await expect(secondOpenImgs).toHaveCount(1);
		await expect(secondOpenImgs.nth(0)).toHaveAttribute("alt", "Beta sticker");

		// Switch to Mock Guild section and pick Alpha twice so Alpha (score 200) outranks Beta (score 100).
		await picker.locator(".emojirow .emojiSelect").first().click();
		await expect(picker.locator(".emojiTitle")).toHaveText("Mock Guild");
		await picker.locator(".stickerBody .stickerSelect").nth(0).click();
		await expectRequests(mockInstance, isMessageSend, 2);
		await expect(picker).toBeHidden();

		await page.locator("#stickerTB").click();
		await expect(picker).toBeVisible();
		await picker.locator(".emojirow .emojiSelect").first().click();
		await picker.locator(".stickerBody .stickerSelect").nth(0).click();
		await expectRequests(mockInstance, isMessageSend, 3);
		await expect(picker).toBeHidden();

		// Reopen: Frequently Used now lists Alpha (200) before Beta (100).
		await page.locator("#stickerTB").click();
		await expect(picker).toBeVisible();
		await expect(picker.locator(".emojiTitle")).toHaveText("Frequently Used");
		const rankedImgs = picker.locator(".stickerBody .stickerSelect img.sticker");
		await expect(rankedImgs).toHaveCount(2);
		await expect(rankedImgs.nth(0)).toHaveAttribute("alt", "Alpha sticker");
		await expect(rankedImgs.nth(1)).toHaveAttribute("alt", "Beta sticker");
	});

	test("closing without a pick settles cleanly with no unhandled rejection and the composer still works", async ({
		page,
		mockInstance,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		await page.locator("#stickerTB").click();
		const picker = page.locator(".stickerPicker");
		await expect(picker).toBeVisible();

		// Close the picker with a WHEEL event over the message list: closeIfOutside listens
		// for document click/wheel/scroll (contextmenu.ts:300-314), but message-area clicks
		// stopPropagation (never reach document) and layered openers like the channel header
		// REPLACE the menu instead of closing it. Wheel closes with no side effects. The
		// picker held focus (search.focus); re-focus the typebox for typing.
		await page.mouse.move(200, 300);
		await page.mouse.wheel(0, 100);
		await expect(picker).toBeHidden();
		await page.locator("#typebox").click();

		// Mobile profile: sends ride #mobileSend (Enter does not send — typed-mention's idiom).
		await page.locator("#typebox").fill("composer still works");
		await page.locator("#mobileSend").tap();

		const sends = await expectRequests(
			mockInstance,
			(req) =>
				req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`,
			1,
		);
		expect((sends[0]!.body as {content?: string; sticker_ids?: string[]}).content).toBe(
			"composer still works",
		);
		expect((sends[0]!.body as {sticker_ids?: string[]}).sticker_ids).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});

test("empty-sticker mount (default MOCK_GUILD.stickers: []) shows no-stickers title, closes cleanly, and settles", async ({
	page,
	mockInstance,
}) => {
	const pageErrors: Error[] = [];
	page.on("pageerror", (err) => pageErrors.push(err));

	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#stickerTB").click();
	const picker = page.locator(".stickerPicker");
	await expect(picker).toBeVisible();
	await expect(picker.locator("h2")).toHaveText(
		"That's unfortunate, there are no stickers for you to use!",
	);

	// Close with a wheel event over the message list (closeIfOutside's document wheel
	// listener — clicks in the message area stopPropagation, header clicks replace the
	// menu), then re-focus the typebox for the composer-send pin.
	await page.mouse.move(200, 300);
	await page.mouse.wheel(0, 100);
	await expect(picker).toBeHidden();
	await page.locator("#typebox").click();

	await page.locator("#typebox").fill("after empty sticker close");
	await page.locator("#mobileSend").tap();

	const sends = await expectRequests(
		mockInstance,
		(req) =>
			req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`,
		1,
	);
	expect((sends[0]!.body as {content?: string}).content).toBe("after empty sticker close");
	expect(pageErrors).toEqual([]);
});
