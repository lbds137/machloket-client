import {expect} from "@playwright/test";
import {MOCK_SPOILER_MESSAGE, loginAndOpenChannel, pinShot, test} from "./fixtures";

// The verification tooling's long tail, first item: the embed card look (walk item:
// "rich embed with a thumbnail — small image top-right in-card") and the YouTube card's
// tap-to-player swap. Actual playback stays a physical check (autoplay policy is a
// real-device thing); what mechanizes is the DOM swap and the card chrome. The embed
// images are the mock's (e2e/mock EMBED_ASSETS), served on their foreign host.

test("the rich embed shows its thumbnail at the top right, text flowing beside", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const card = page.locator(".rich-embed");
	await expect(card).toHaveCount(1);
	await card.scrollIntoViewIfNeeded();

	const thumb = card.locator("img.embedThumbnail");
	await expect(thumb).toBeVisible();
	// The src lands via refreshIfNeeded's promise, not at insert time; complete only
	// means loaded once naturalWidth agrees.
	await expect(thumb).toHaveJSProperty("complete", true);
	await expect(thumb).toHaveJSProperty("naturalWidth", 96);

	// The walk item, mechanized: small image AT THE TOP RIGHT, text beside it.
	const thumbBox = (await thumb.boundingBox())!;
	const cardBox = (await card.boundingBox())!;
	expect(thumbBox.x + thumbBox.width).toBeGreaterThan(cardBox.x + cardBox.width - 24);
	expect(thumbBox.y).toBeLessThan(cardBox.y + 24);

	// The fixture grows oldest-first: the embed message renders ABOVE the button message
	// (the previously-oldest), portably - no pixels involved.
	const buttonMessage = page.locator(".messagediv", {hasText: "Need some details:"});
	await expect(buttonMessage).toHaveCount(1);
	const buttonBox = (await buttonMessage.boundingBox())!;
	expect(cardBox.y).toBeLessThan(buttonBox.y);

	await expect(card.locator(".provider")).toHaveText("CardBot");
	await expect(card.locator(".embedtitle")).toHaveText("Character: Juniper");
	const titleBox = (await card.locator(".embedtitle").boundingBox())!;
	expect(titleBox.x).toBeLessThan(thumbBox.x);
	await expect(card.locator(".embedFields .inline")).toHaveCount(2);
	await expect(card).toContainText("CardBot • e2e");

	// The card's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await pinShot(card, "embed-rich-thumb.png");
});

test("the video embed swaps its poster for a YouTube player iframe on tap", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const poster = page.locator("img.bigembedimg");
	await expect(poster).toBeVisible();
	await poster.scrollIntoViewIfNeeded();
	await expect(poster).toHaveJSProperty("complete", true);
	await expect(poster).toHaveJSProperty("naturalWidth", 96);

	// The player frame's own load: answered with an empty page so no real network is
	// touched (fixtures.ts's net would otherwise fail the test over it).
	await page.route("https://www.youtube.com/embed/**", (route) =>
		route.fulfill({contentType: "text/html", body: "<!doctype html><title>player</title>"}),
	);
	await poster.tap();

	// youtubeEmbedSrc whitelists the YouTube player hosts and appends autoplay=1.
	const player = page.locator("iframe");
	await expect(player).toHaveCount(1);
	await expect(player).toHaveJSProperty(
		"src",
		"https://www.youtube.com/embed/e2eFixtured01?autoplay=1",
	);
	await expect(poster).toHaveCount(0);
});

test("the video embed's poster and player stay on a phone screen and keep their shape", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	const viewportWidth = page.viewportSize()!.width;

	const poster = page.locator("img.bigembedimg");
	await poster.scrollIntoViewIfNeeded();
	await expect(poster).toHaveJSProperty("complete", true);
	const posterBox = (await poster.boundingBox())!;
	expect(posterBox.x + posterBox.width, "poster's right edge").toBeLessThanOrEqual(viewportWidth);

	await page.route("https://www.youtube.com/embed/**", (route) =>
		route.fulfill({contentType: "text/html", body: "<!doctype html><title>player</title>"}),
	);
	await poster.tap();

	const player = page.locator("iframe");
	await expect(player).toHaveCount(1);
	const playerBox = (await player.boundingBox())!;
	expect(playerBox.x + playerBox.width, "player's right edge").toBeLessThanOrEqual(viewportWidth);
	// First: a leftover border misses the shape below by only 0.0005 at this width.
	await expect(player, "the browser's border is off the player").toHaveCSS("border-top-style", "none");
	// The fixture video is 1280x720, under a 480x360 poster.
	expect(playerBox.height / playerBox.width, "player keeps the video's shape").toBeCloseTo(0.5625, 2);
});

test("the player's border reset stays on the player, away from other frames", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);

	const border = await page.evaluate(() => {
		const frame = document.body.appendChild(document.createElement("iframe"));
		return getComputedStyle(frame).borderTopStyle;
	});
	expect(border, "a frame outside an embed keeps the browser's border").toBe("inset");
});

test.describe("an article embed whose image reports no size", () => {
	// On this block's mount only, so the shared #general layout stays as every other spec knows it.
	const WIDE_IMAGE_URL = "http://127.0.0.1:4173/e2e-assets/wide.svg";
	test.use({
		mockInstanceOptions: {
			messages: [
				{
					...MOCK_SPOILER_MESSAGE,
					content: "an unsized image:",
					attachments: [],
					embeds: [
						{
							type: "article",
							author: {},
							provider: {name: "e2e"},
							title: "wide",
							// embedjson calls the size required; generateArticle already allows for its absence.
							thumbnail: {url: WIDE_IMAGE_URL, proxy_url: WIDE_IMAGE_URL} as never,
						},
					],
				},
			],
		},
	});

	// generateArticle sizes an image only when told its width; here `.message img` is the only cap.
	test("stays on a phone screen and keeps its shape", async ({page, mockInstance}) => {
		void mockInstance;
		await page.route(WIDE_IMAGE_URL, (route) =>
			route.fulfill({
				contentType: "image/svg+xml",
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#8a5a2b"/></svg>',
			}),
		);
		await loginAndOpenChannel(page);
		const viewportWidth = page.viewportSize()!.width;

		const image = page.locator("img.bigembedimg");
		await image.scrollIntoViewIfNeeded();
		await expect(image).toHaveJSProperty("complete", true);
		await expect(image).toHaveJSProperty("naturalWidth", 1600);

		const box = (await image.boundingBox())!;
		expect(box.x + box.width, "image's right edge").toBeLessThanOrEqual(viewportWidth);
		expect(box.height / box.width, "image keeps its shape").toBeCloseTo(0.25, 2);
	});
});
