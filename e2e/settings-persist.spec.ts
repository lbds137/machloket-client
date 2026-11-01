import {expect, type Page} from "@playwright/test";
import {MOCK_CHANNEL_ID, MOCK_GUILD_ID, loginAndOpenChannel, test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});

test.beforeEach(({mockInstance}) => {
	void mockInstance;
});

async function openSettingsCard(page: Page, section: string, cardLabel: string, cardId: string) {
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();
	await page
		.locator(`.settingbuttons .cardLink[data-section="${section}"]`, {hasText: cardLabel})
		.click();
	const card = page.locator(cardId);
	await expect(card).toBeVisible();
	return card;
}

test("theme change in Appearance updates body theme class and persists across reload", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	await expect(page.locator("body")).toHaveClass("Onyx-theme");

	const appearance = await openSettingsCard(page, "App settings", "Appearance", "#card-appearance");
	const themeSelect = appearance
		.locator(".optionElement")
		.filter({has: page.locator("span", {hasText: /^Theme$/})})
		.locator("select");
	await expect(themeSelect).toHaveValue("Onyx");

	await themeSelect.selectOption({label: "Light"});
	await page.locator(".savediv button").click();
	await expect(page.locator("body")).toHaveClass("Light-theme");

	await page.reload();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
	await expect(page.locator("body")).toHaveClass("Light-theme");
});

test("Privacy spoiler Block selection survives a subsequent preference write and reload", async ({
	page,
}) => {
	await loginAndOpenChannel(page);

	const privacy = await openSettingsCard(page, "Your account", "Privacy", "#card-privacy");
	const spoilersSelect = privacy
		.locator(".optionElement", {hasText: "Spoiler-tagged content"})
		.locator("select");
	await spoilersSelect.selectOption({label: "Block"});
	await expect(spoilersSelect).toHaveValue("Block");

	await page
		.locator('.settingbuttons .cardLink[data-section="App settings"]', {hasText: "Appearance"})
		.click();
	const appearance = page.locator("#card-appearance");
	await expect(appearance).toBeVisible();
	const accentInput = appearance
		.locator(".optionElement", {hasText: "Theme accent color:"})
		.locator('input[type="color"]');
	await accentInput.fill("#123456");
	await page.locator(".savediv button").click();
	await expect(page.locator("html")).toHaveAttribute("style", /--accent-color:\s*#123456/);

	// Re-boot through a channel deep link: a plain reload keeps the settings URL and parks the
	// guild view half-booted (settings-content-controls.spec.ts).
	await page.goto(`/channels/${MOCK_GUILD_ID}/${MOCK_CHANNEL_ID}`);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});

	const reloadedPrivacy = await openSettingsCard(page, "Your account", "Privacy", "#card-privacy");
	const reloadedSpoilers = reloadedPrivacy
		.locator(".optionElement", {hasText: "Spoiler-tagged content"})
		.locator("select");
	await expect(reloadedSpoilers).toHaveValue("Block");
});
