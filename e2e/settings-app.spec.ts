import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});

async function openSettings(page: Page): Promise<void> {
	await loginAndOpenChannel(page);
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();
}

async function openLeaf(page: Page, leaf: string): Promise<void> {
	const nav = page.locator(".settingbuttons");
	await nav.locator('.cardLink[data-section="App settings"]', {hasText: leaf}).click();
}

test("Appearance holds the theme and accent controls; Notifications holds the sound controls", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	await openLeaf(page, "Appearance");
	const appearanceCard = page.locator("#card-appearance");
	await expect(appearanceCard).toBeVisible();
	// Exactly one select (the theme picker), offering the built-in themes.
	await expect(appearanceCard.locator("select")).toContainText("Onyx");
	await expect(appearanceCard.getByText("Theme accent color:")).toBeVisible();

	await openLeaf(page, "Notifications");
	const notificationsCard = page.locator("#card-notifications");
	await expect(notificationsCard).toBeVisible();
	await expect(notificationsCard.locator("select")).toContainText("Default");
	await expect(notificationsCard.locator('input[type="range"]')).toBeVisible();
	await expect(notificationsCard.getByText("Notification volume:")).toBeVisible();
	await expect(notificationsCard.getByRole("button", {name: "Add new sound"})).toBeVisible();
});

test("Chat holds the emoji font and join-avatar controls", async ({page, mockInstance}) => {
	void mockInstance;
	await openSettings(page);

	await openLeaf(page, "Chat");
	const chatCard = page.locator("#card-chat");
	await expect(chatCard).toBeVisible();
	await expect(chatCard.locator("select")).toContainText("Noto Color Emoji");
	await expect(chatCard.getByText("Display avatars for new members:")).toBeVisible();
	await expect(chatCard.locator('input[type="checkbox"]')).toHaveCount(1);
});

test("Voice & video renders the input device picker with System default first", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	await openLeaf(page, "Voice & video");
	// "&" in the leaf name lands in the card id verbatim: locate by attribute, not by
	// an id selector a CSS engine would reject.
	const card = page.locator('[id="card-voice-&-video"]');
	await expect(card).toBeVisible();
	const select = card.locator("select");
	await expect(select).toBeVisible();
	// Headless Chromium may expose zero or placeholder devices; the System default
	// entry is the only one the picker guarantees.
	await expect(select.locator("option").first()).toHaveText("System default");
});

test("Application keeps Update settings and Trusted Domains and loses Language", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const applicationLinks = nav.locator('.cardLink[data-section="Application"]');
	await expect(applicationLinks.filter({hasText: "Language"})).toHaveCount(0);
	await expect(applicationLinks.filter({hasText: "Update settings"})).toBeVisible();
	await expect(applicationLinks.filter({hasText: "Trusted Domains"})).toBeVisible();

	// Language still works, from its new home in App settings.
	await openLeaf(page, "Language");
	const languageCard = page.locator("#card-language");
	await expect(languageCard).toBeVisible();
	await expect(languageCard.locator("select")).toBeVisible();
});

test("deep link #settings/app-settings pre-activates the section", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	await page.evaluate(() => {
		window.location.hash = "#settings/app-settings";
	});
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();

	const header = page.locator('.sectionHeader[data-section="App settings"]');
	await expect(header).toHaveClass(/activeSetting/);
	await expect(page).toHaveURL(/#settings\/app-settings$/);
});
