import {expect, type Route} from "@playwright/test";
import {
	MOCK_EMBED_POSTER_URL,
	MOCK_EMBED_THUMB_URL,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// The verification tooling's long tail, first item: the embed card look (walk item:
// "rich embed with a thumbnail — small image top-right in-card") and the YouTube card's
// tap-to-player swap. Actual playback stays a physical check (autoplay policy is a
// real-device thing); what mechanizes is the DOM swap and the card chrome.

// Inline SVGs, not binary PNGs: deterministic by construction and readable in review.
// Pure shapes, no text, so no font metrics enter the Deck-local baseline.
const svg = (body: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${body}</svg>`;

const THUMB_SVG = svg(
	'<circle cx="48" cy="48" r="40" fill="#2d7d46"/><rect x="40" y="16" width="16" height="64" fill="#7bd389"/>',
);
const POSTER_SVG = svg(
	'<rect width="96" height="96" fill="#8a5a2b"/><polygon points="38,30 70,48 38,66" fill="#f0e6d2"/>',
);

async function fulfillEmbedAssets(route: Route): Promise<void> {
	const path = new URL(route.request().url()).pathname;
	if (path === new URL(MOCK_EMBED_THUMB_URL).pathname) {
		return route.fulfill({contentType: "image/svg+xml", body: THUMB_SVG});
	}
	if (path === new URL(MOCK_EMBED_POSTER_URL).pathname) {
		return route.fulfill({contentType: "image/svg+xml", body: POSTER_SVG});
	}
	return route.fulfill({status: 404, body: "unmocked e2e asset"});
}

test.beforeEach(async ({page}) => {
	// Registered before the boot; page routes also outrank fixtures.ts's context-level
	// abort net (which allows 127.0.0.1 anyway - the embed images deliberately live on a
	// different host than the mock's cdn, the third-party-host shape of real embeds).
	await page.route("http://127.0.0.1:4173/e2e-assets/*", fulfillEmbedAssets);
});

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
	await expect(card).toHaveScreenshot("embed-rich-thumb.png");
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

	await poster.tap();

	// youtubeEmbedSrc whitelists the YouTube player hosts and appends autoplay=1; the
	// cross-origin frame load itself is aborted by fixtures.ts's net - irrelevant to the
	// swap this pins.
	const player = page.locator("iframe");
	await expect(player).toHaveCount(1);
	await expect(player).toHaveJSProperty(
		"src",
		"https://www.youtube.com/embed/e2eFixtured01?autoplay=1",
	);
	await expect(poster).toHaveCount(0);
});
