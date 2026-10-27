import {mkdirSync} from "node:fs";
import path from "node:path";
import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// Documentation captures for the emoji/composer comparison rows (scope doc:
// docs/local/ux-compare/emoji-composer-scope.md, screenshot pass). NOT regression
// pins: no baselines, no behavior asserts beyond "it opened" — the PNGs land in
// docs/local/ux-compare/shots/ for the Discord-truth comparison. Skipped unless
// SYG_SHOTS=1 so the CI tier pays nothing for them.
test.skip(!process.env.SYG_SHOTS, "documentation captures — run with SYG_SHOTS=1");

const SHOTS = path.join(process.cwd(), "docs", "local", "ux-compare", "shots");

async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
	// Let entry animations/transitions settle; documentation, not pixel pins.
	await page.waitForTimeout(400);
	await page.screenshot({path: path.join(SHOTS, name)});
}

test("capture: floating emoji picker + bare rows (phone)", async ({page, mockInstance}) => {
	mkdirSync(SHOTS, {recursive: true});
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#typebox").click();
	await page.keyboard.type("hello");
	await page.locator("#emojiTB").click();
	await expect(page.locator(".emojiPicker")).toBeVisible();
	await shot(page, "picker-open-phone.png");

	// Row E evidence: the hovered row carries only a Hover tooltip, no :name: footer.
	await page.locator(".emojiPicker .emojiBody .emojiSelect").first().hover();
	await shot(page, "emoji-row-hover-phone.png");
});

test.describe("desktop viewport", () => {
	test.use({viewport: {width: 1280, height: 800}});

	test("capture: floating emoji picker (desktop)", async ({page, mockInstance}) => {
		mkdirSync(SHOTS, {recursive: true});
		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		await page.locator("#typebox").click();
		await page.keyboard.type("hello");
		await page.locator("#emojiTB").click();
		await expect(page.locator(".emojiPicker")).toBeVisible();
		await shot(page, "picker-open-desktop.png");
	});
});

test("capture: GIF picker (phone)", async ({page, mockInstance}) => {
	mkdirSync(SHOTS, {recursive: true});
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	// The picker's server-proxied trending call has no mock answer; the empty body
	// documents the picker's empty state under this config (the docs capture asks
	// "what renders", not "what the providers return").
	await page.route("**/api/v9/gifs/trending*", (route) =>
		route.fulfill({status: 200, contentType: "application/json", body: "[]"}),
	);

	await page.locator("#gifTB").click();
	await shot(page, "gif-picker-phone.png");
});

test("capture: sticker picker (phone)", async ({page, mockInstance}) => {
	mkdirSync(SHOTS, {recursive: true});
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#stickerTB").click();
	await shot(page, "sticker-picker-phone.png");
});

// No poll-modal capture yet: the mock's @everyone role lacks SEND_POLLS, so the
// "+"-menu renders only "Upload files". A mock option granting extra permission bits
// is filed in the tracker — it serves this capture and EMOJI-C's validation pins.
