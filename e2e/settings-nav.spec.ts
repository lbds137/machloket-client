import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});

async function openSettings(page: Page): Promise<void> {
	await loginAndOpenChannel(page);
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();
}

test("search box renders and filters nav rows live", async ({page, mockInstance}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const search = nav.getByPlaceholder("Search settings");
	await expect(search).toBeVisible();

	const themesLink = nav.locator(".cardLink", {hasText: "Themes & Sounds"});
	const accountLink = nav.locator(".cardLink", {hasText: "Account settings"});
	await expect(themesLink).toBeVisible();
	await expect(accountLink).toBeVisible();

	await search.fill("theme");
	await expect(themesLink).toBeVisible();
	await expect(accountLink).toBeHidden();

	await search.fill("");
	await expect(themesLink).toBeVisible();
	await expect(accountLink).toBeVisible();
});

test("the chevron toggles a section and the label click navigates without collapsing", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const header = nav.locator('.sectionHeader[data-section="Appearance"]');
	const chevron = header.locator(".sectionChevron");
	const themesLink = nav.locator('.cardLink[data-section="Appearance"]', {
		hasText: "Themes & Sounds",
	});

	// Label click: navigates to the section and must NEVER collapse it — the rendered
	// page fills the htmlarea while the nav stays truthful (aria-expanded stays true).
	await header.click();
	await expect(header).toHaveAttribute("aria-expanded", "true");
	await expect(themesLink).toBeVisible();

	// The chevron is the toggle.
	await chevron.click();
	await expect(header).toHaveAttribute("aria-expanded", "false");
	await expect(themesLink).toBeHidden();

	await chevron.click();
	await expect(header).toHaveAttribute("aria-expanded", "true");
	await expect(themesLink).toBeVisible();
});

test("activating a section sets the hash and reload pre-activates that section", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const firstHeader = nav.locator('.sectionHeader[data-section="Appearance"]');
	const targetHeader = nav.locator('.sectionHeader[data-section="Application"]');

	await expect(firstHeader).toHaveClass(/activeSetting/);
	await targetHeader.click();
	await expect(targetHeader).toHaveClass(/activeSetting/);
	await expect(page).toHaveURL(/#settings\/application$/);

	await page.reload();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
	await page.locator("#settings").click();

	await expect(targetHeader).toHaveClass(/activeSetting/);
	await expect(firstHeader).not.toHaveClass(/activeSetting/);
});

test("keyboard ArrowRight and ArrowLeft on a focused header flip aria-expanded", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const header = nav.locator('.sectionHeader[data-section="Your account"]');
	const cardLink = nav.locator('.cardLink[data-section="Your account"]', {
		hasText: "Account settings",
	});

	await expect(header).toHaveAttribute("aria-expanded", "true");
	await expect(cardLink).toBeVisible();

	await header.focus();
	await page.keyboard.press("ArrowLeft");
	await expect(header).toHaveAttribute("aria-expanded", "false");
	await expect(cardLink).toBeHidden();

	await page.keyboard.press("ArrowRight");
	await expect(header).toHaveAttribute("aria-expanded", "true");
	await expect(cardLink).toBeVisible();
});

test("foot build info row renders and contains a version-looking string", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const foot = nav.locator(".settingsBuildInfo");
	await expect(foot).toBeVisible();
	await expect(foot).toHaveText(/^Machloket web \d+\.\d+\.\d+/);
});
