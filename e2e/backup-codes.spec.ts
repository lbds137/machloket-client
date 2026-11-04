import {readFileSync} from "node:fs";
import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// The codes screen at phone width, where a stray tap must not lose codes shown only once. What
// the server mints and accepts is e2e-real/backup-codes.spec.ts; the rendering is here.
const CODES = Array.from({length: 10}, (_, i) => `${i}a${i}b${i}c${i}d`);
const REGEN_CODES = Array.from({length: 10}, (_, i) => `${i}z${i}y${i}x${i}w`);

async function openEnrollment(page: Page): Promise<void> {
	await loginAndOpenChannel(page);
	// The channel view covers the sidebar's button at this width; the route there isn't this spec's.
	await page.locator("#settings").dispatchEvent("click");
	await page.locator(".settingbuttons .cardLink", {hasText: "Account settings"}).click();
	await page.getByRole("button", {name: "Enable 2FA", exact: true}).click();
}

test("the codes fit a phone and survive a tap outside and Escape, until I've saved them", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await page.route("**/api/v9/users/@me/mfa/totp/enable/", (route) =>
		route.fulfill({
			json: {token: "fresh", backup_codes: CODES.map((code) => ({code, consumed: false}))},
		}),
	);
	await openEnrollment(page);

	const form = page.locator(".FormSettings", {
		has: page.getByText("Your TOTP secret is:", {exact: false}),
	});
	await form
		.locator("div", {has: page.getByText("Password", {exact: true})})
		.locator("input[type=password]")
		.last()
		.fill("pw");
	await form
		.locator("div", {has: page.getByText("Code:", {exact: true})})
		.locator("input")
		.last()
		.fill("123456");
	await form.getByRole("button", {name: "Submit", exact: true}).click();

	const screen = page.locator(".dialogModal", {has: page.locator(".backupCodeGrid")});
	await expect(screen).toBeVisible();
	await expect(screen.locator(".backupCodeGrid code")).toHaveText(CODES);

	const width = page.viewportSize()!.width;
	const box = (await screen.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(width);
	for (const code of await screen.locator(".backupCodeGrid code").all()) {
		await code.scrollIntoViewIfNeeded();
		await expect(code).toBeInViewport({ratio: 1});
	}

	await page.mouse.click(2, 2);
	await page.keyboard.press("Escape");
	await expect(screen).toBeVisible();

	const download = page.waitForEvent("download");
	await screen.getByRole("button", {name: "Download codes", exact: true}).tap();
	const file = await download;
	expect(file.suggestedFilename()).toBe("machloket-backup-codes.txt");
	expect(readFileSync(await file.path(), "utf8")).toBe(CODES.join("\n") + "\n");
	await expect(screen).toBeVisible();

	const done = screen.getByRole("button", {name: "I've saved them", exact: true});
	await done.scrollIntoViewIfNeeded();
	await expect(done).toBeInViewport({ratio: 1});
	if (process.env.E2E_SHOTS) await page.screenshot({path: "docs/local/backup-codes-phone.png"});
	await done.tap();
	await expect(screen).toHaveCount(0);
});

test("viewing codes from the security grid shows them once; regenerate replaces them in the same dialog", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	// The mock user has no second factor, so the verification answers without the
	// MFA header (requireApplicationMfa passes for a factorless owner).
	await page.route("**/api/v9/auth/verify/view-backup-codes-challenge", (route) =>
		route.fulfill({json: {nonce: "n-view", regenerate_nonce: "n-regen"}}),
	);
	let regenerations = 0;
	await page.route("**/api/v9/users/@me/mfa/codes-verification", (route) => {
		const body = route.request().postDataJSON() as {regenerate?: boolean};
		if (body?.regenerate === true) {
			regenerations++;
			return route.fulfill({
				json: {backup_codes: REGEN_CODES.map((code) => ({code, consumed: false}))},
			});
		}
		return route.fulfill({json: {backup_codes: CODES.map((code) => ({code, consumed: false}))}});
	});

	await loginAndOpenChannel(page);
	await page.locator("#settings").dispatchEvent("click");
	await page.locator(".settingbuttons .cardLink", {hasText: "Account settings"}).click();
	await page.getByRole("button", {name: "View backup codes", exact: true}).click();
	// The pane's id scopes this form away from the account-deletion form's password field.
	const card = page.locator("#card-account-settings");
	await card.locator("input[type=password]").fill("pw");
	await card.getByRole("button", {name: "Submit", exact: true}).click();

	const screen = page.locator(".dialogModal", {has: page.locator(".backupCodeGrid")});
	await expect(screen).toBeVisible();
	await expect(screen.locator(".backupCodeGrid code")).toHaveText(CODES);
	await page.mouse.click(2, 2);
	await page.keyboard.press("Escape");
	await expect(screen).toBeVisible();

	await screen.getByRole("button", {name: "Regenerate codes", exact: true}).tap();
	await expect(screen.locator(".backupCodeGrid code")).toHaveText(REGEN_CODES);
	expect(regenerations).toBe(1);
});
