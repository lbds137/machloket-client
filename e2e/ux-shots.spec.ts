import {mkdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// Documentation captures for the emoji/composer comparison rows (scope doc:
// docs/local/ux-compare/emoji-composer-scope.md, screenshot pass). NOT regression
// pins: no baselines — the PNGs land in docs/local/ux-compare/shots/ for the
// Discord-truth comparison. Every capture asserts its surface actually mounted
// before shooting, so a half-built or crashed menu can't masquerade as a shot.
// Skipped unless E2E_SHOTS=1 (run a spec directly with that env) so the CI tier
// pays nothing for them.
test.skip(!process.env.E2E_SHOTS, "documentation captures — run with E2E_SHOTS=1");

// Anchored to this file, not the invocation cwd, so the shots always land inside
// the git-ignored docs/local tree.
const SHOTS = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"docs",
	"local",
	"ux-compare",
	"shots",
);

async function shot(page: Page, name: string): Promise<void> {
	mkdirSync(SHOTS, {recursive: true});
	// Let entry animations/transitions settle; documentation, not pixel pins.
	await page.waitForTimeout(400);
	await page.screenshot({path: path.join(SHOTS, name)});
}

// The mockInstance fixture arms the mock (Playwright fixtures are lazy — without
// destructuring it, the instance list never populates). loginAndOpenChannel itself
// proves the boot worked; no extra assert needed here.
test("capture: floating emoji picker + bare rows (phone)", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	void mockInstance;

	await page.locator("#typebox").click();
	await page.keyboard.type("hello");
	await page.locator("#emojiTB").click();
	await expect(page.locator(".emojiPicker")).toBeVisible();
	await shot(page, "picker-open-phone.png");

	// Row E evidence: the hovered row carries only a Hover tooltip, no :name: footer.
	await page.locator(".emojiPicker .emojiBody .emojiSelect").first().hover();
	await shot(page, "emoji-row-hover-phone.png");
});

// A REAL desktop run, not a wide phone: the Pixel 7 profile's Android UA and
// touch flags survive a viewport override, and the app's `mobile` check keys on
// exactly those (utils/utils.ts) — override all three.
test.describe("desktop", () => {
	test.use({
		viewport: {width: 1280, height: 800},
		userAgent:
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		isMobile: false,
		hasTouch: false,
	});

	test("capture: floating emoji picker (desktop)", async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		void mockInstance;

		await page.locator("#typebox").click();
		await page.keyboard.type("hello");
		await page.locator("#emojiTB").click();
		await expect(page.locator(".emojiPicker")).toBeVisible();
		await shot(page, "picker-open-desktop.png");
	});
});

test("capture: GIF picker (phone)", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	void mockInstance;

	// The picker's server-proxied trending call has no mock answer; an empty
	// categories payload is the documented state ("no providers configured"),
	// rendered through the picker's normal success path. `[]` would crash it —
	// fetchTrending only bails on a falsy body, then reads .categories.
	await page.route("**/api/v9/gifs/trending*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({categories: [], gifs: []}),
		}),
	);

	await page.locator("#gifTB").click();
	// The search box is only added after trending parses — proving the picker
	// built fully, not just that a menu div mounted.
	await expect(page.locator(".gifmenu input")).toBeVisible();
	await shot(page, "gif-picker-phone.png");
});

test("capture: sticker picker (phone)", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	void mockInstance;

	await page.locator("#stickerTB").click();
	// The root mounts even when no guild carries stickers (a "no stickers" title,
	// then a never-settling promise — scope row J); the shot documents whichever
	// state the mock produces.
	await expect(page.locator(".stickerPicker")).toBeVisible();
	await shot(page, "sticker-picker-phone.png");
});
