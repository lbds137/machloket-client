import {readFileSync} from "fs";
import {expect, type Page} from "@playwright/test";
import {MOCK_EXPORT_FILENAME, MOCK_USER_EXPORT, loginAndOpenChannel, test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});

async function openSettings(page: Page): Promise<void> {
	await loginAndOpenChannel(page);
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();
}

async function openPrivacyCard(page: Page) {
	await openSettings(page);
	const nav = page.locator(".settingbuttons");
	const privacyLink = nav.locator('.cardLink[data-section="Your account"]', {
		hasText: "Privacy",
	});
	await privacyLink.click();
	const card = page.locator("#card-privacy");
	await expect(card).toBeVisible();
	return card;
}

test("the nav shows the Your account header with its six leaves in order", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const appearanceHeader = nav.locator('.sectionHeader[data-section="Appearance"]');
	await expect(appearanceHeader).toBeVisible();
	await expect(nav.locator('.cardLink[data-section="Appearance"]')).toHaveText([
		"Themes & Sounds",
		"Accessibility",
	]);

	const accountHeader = nav.locator('.sectionHeader[data-section="Your account"]');
	await expect(accountHeader).toBeVisible();
	await expect(nav.locator('.cardLink[data-section="Your account"]')).toHaveText([
		"Your public profile",
		"Account settings",
		"Privacy",
		"Connections",
		"Manage sessions",
		"Account deletion",
	]);
});

test("Download your data saves the exported JSON with the Content-Disposition filename", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const card = await openPrivacyCard(page);

	const downloadPromise = page.waitForEvent("download");
	await card.getByRole("button", {name: "Download your data"}).click();
	const download = await downloadPromise;

	expect(download.suggestedFilename()).toBe(MOCK_EXPORT_FILENAME);
	const filePath = await download.path();
	expect(filePath).not.toBeNull();
	const parsed = JSON.parse(readFileSync(filePath!, "utf-8"));
	expect(parsed).toEqual(MOCK_USER_EXPORT);
});

test("a 500 on export shows the refusal line and triggers no download", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const card = await openPrivacyCard(page);

	await page.route("**/api/v9/users/@me/export", (route) =>
		route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({message: "boom"}),
		}),
	);

	let downloaded = false;
	page.on("download", () => {
		downloaded = true;
	});

	await card.getByRole("button", {name: "Download your data"}).click();
	const refusal = card.locator(".dataExportRefusal");
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText("That didn't go through (boom). Try again in a moment.");
	expect(downloaded).toBe(false);
});

test("an aborted export request shows the offline refusal line and triggers no download", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const card = await openPrivacyCard(page);

	await page.route("**/api/v9/users/@me/export", (route) => route.abort("failed"));

	let downloaded = false;
	page.on("download", () => {
		downloaded = true;
	});

	await card.getByRole("button", {name: "Download your data"}).click();
	const refusal = card.locator(".dataExportRefusal");
	await expect(refusal).toBeVisible();
	await expect(refusal).toContainText("That didn't go through (offline). Try again in a moment.");
	expect(downloaded).toBe(false);
});

test("sensitive-content selects persist across page reload", async ({page, mockInstance}) => {
	void mockInstance;
	const card = await openPrivacyCard(page);

	const spoilersSelect = card
		.locator(".optionElement", {hasText: "Spoiler-tagged content"})
		.locator("select");
	const nsfwSelect = card.locator(".optionElement", {hasText: "NSFW content"}).locator("select");

	await expect(spoilersSelect).toHaveValue("Show");
	await expect(nsfwSelect).toHaveValue("Show");

	await spoilersSelect.selectOption({label: "Blur"});
	await nsfwSelect.selectOption({label: "Blur"});
	await expect(spoilersSelect).toHaveValue("Blur");
	await expect(nsfwSelect).toHaveValue("Blur");

	await page.reload();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
	await page.locator("#settings").click();
	await page
		.locator('.settingbuttons .cardLink[data-section="Your account"]', {hasText: "Privacy"})
		.click();

	const reloadedCard = page.locator("#card-privacy");
	await expect(
		reloadedCard.locator(".optionElement", {hasText: "Spoiler-tagged content"}).locator("select"),
	).toHaveValue("Blur");
	await expect(
		reloadedCard.locator(".optionElement", {hasText: "NSFW content"}).locator("select"),
	).toHaveValue("Blur");
});

test("searching a query that matches only the Privacy leaf keeps the Your account header visible", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await openSettings(page);

	const nav = page.locator(".settingbuttons");
	const search = nav.getByPlaceholder("Search settings");
	const accountHeader = nav.locator('.sectionHeader[data-section="Your account"]');
	const appearanceHeader = nav.locator('.sectionHeader[data-section="Appearance"]');
	const privacyLink = nav.locator('.cardLink[data-section="Your account"]', {
		hasText: "Privacy",
	});
	const accountSettingsLink = nav.locator('.cardLink[data-section="Your account"]', {
		hasText: "Account settings",
	});

	await search.fill("download");
	await expect(privacyLink).toBeVisible();
	await expect(accountHeader).toBeVisible();
	await expect(accountSettingsLink).toBeHidden();
	await expect(appearanceHeader).toBeHidden();
});
