import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// Pins `MockInstanceOptions.extraEveryonePermissions` against the composer "+" menu
// (`#upload`, bound with `bindContextmenu(..., "left")` in `src/webpage/index.ts:765-796`).
// A plain left click dispatches `LayeredEvent`, which opens `div.contextmenu` inside a
// `queueMicrotask` (`src/webpage/contextmenu.ts:251-266, 379, 464-466`); Playwright's
// auto-retrying visibility expectations absorb that microtask open delay.
//
// "Make poll" (`translations/en.json:981`) is gated on
// `thisUser.channelfocus?.hasPermission("SEND_POLLS")` (`src/webpage/index.ts:766-774`),
// whereas "Upload files" (`translations/en.json:980`, matched by "Upload") has no `visible`
// gate (`:775`) and always renders.

test.describe("when extraEveryonePermissions grants SEND_POLLS", () => {
	test.use({mockInstanceOptions: {extraEveryonePermissions: ["SEND_POLLS"]}});

	test('composer "+" menu shows "Make poll" and "Upload"', async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		// Positive control that the mock actually armed (emoji-button / user-dock pattern).
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		await page.locator("#upload").click();

		const menu = page.locator(".contextmenu");
		await expect(menu).toBeVisible();
		await expect(menu.locator(".contextbutton", {hasText: "Make poll"})).toBeVisible();
		await expect(menu.locator(".contextbutton", {hasText: "Upload"})).toBeVisible();
	});
});

test('default mount: composer "+" menu omits "Make poll" and shows "Upload"', async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#upload").click();

	const menu = page.locator(".contextmenu");
	await expect(menu).toBeVisible();
	await expect(menu.locator(".contextbutton", {hasText: "Upload"})).toBeVisible();
	await expect(menu.locator(".contextbutton", {hasText: "Make poll"})).toHaveCount(0);
	await expect(menu).not.toContainText("Make poll");
});
