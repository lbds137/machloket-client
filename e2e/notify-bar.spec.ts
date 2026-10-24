import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// T3 phone-layout, second half: the "enable notifications" bar (walk item 1e) — it shows
// while Notification.permission is genuinely unset, its dismissal sticks, and a granted
// permission never shows it (notifyBanner.ts installs at boot, index.ts).

// Headless Chromium denies notification permission outright, so the app's "unset" gate
// (permission === "default") is unreachable for real here; stub the static to pin the
// APP's logic (notifyBanner.ts), which is what these two specs are about.
async function stubPermissionDefault(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(Notification, "permission", {
			get: () => "default",
			configurable: true,
		});
	});
}

test("the bar shows while permission is unset", async ({page, mockInstance}) => {
	// The mock's routes must mount (a fixture runs only when a test requests it); the
	// handle itself stays unread.
	void mockInstance;
	await stubPermissionDefault(page);
	await loginAndOpenChannel(page);

	const banner = page.locator("#notifyBanner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("Don't miss messages — enable notifications");
	await expect(banner.getByRole("button", {name: "Enable"})).toBeVisible();

	// The bar's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(banner).toHaveScreenshot("notify-bar.png");
});

test("dismissing the bar sticks across a reload", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await stubPermissionDefault(page);
	await loginAndOpenChannel(page);

	const banner = page.locator("#notifyBanner");
	await expect(banner).toBeVisible();
	// The dismiss button by ID — the same handle notifyBanner.ts itself binds.
	await page.locator("#notifyBannerDismiss").tap();
	await expect(banner).toBeHidden();
	expect(await page.evaluate(() => localStorage.getItem("notifyBannerDismissed"))).toBe("1");

	// A reload boots straight into the stored session; the dismissed key must keep the
	// bar from coming back.
	await page.reload();
	await expect(page.locator("#notifyBanner")).toBeHidden();
});

test("with notifications granted, the bar never shows", async ({page, context, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await context.grantPermissions(["notifications"]);
	await loginAndOpenChannel(page);

	await expect(page.locator("#notifyBanner")).toBeHidden();
});
