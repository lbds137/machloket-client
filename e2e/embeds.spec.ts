import {expect} from "@playwright/test";
import {loginAndOpenChannel, pinShot, test} from "./fixtures";

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
