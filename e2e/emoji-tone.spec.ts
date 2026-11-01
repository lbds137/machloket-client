import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

const MEDIUM_TONE = "\u{1F3FD}";

test.beforeEach(({mockInstance}) => {
	void mockInstance;
});

test("header tone selector applies tone modifier to flagged cells and leaves unflagged cells unchanged", async ({
	page,
}) => {
	await loginAndOpenChannel(page);

	await page.locator("#emojiTB").click();
	const picker = page.locator(".emojiPicker");
	await expect(picker).toBeVisible();

	await picker.locator(".emojirow .emojiSelect", {hasText: "👋"}).click();
	const flaggedCell = picker.locator(".emojiBody .emojiSelect:has(.emojiToneBadge)").first();
	const unflaggedCell = picker.locator(".emojiBody .emojiSelect:not(:has(.emojiToneBadge))").first();
	await expect(flaggedCell).toHaveText("👋");
	const unflaggedText = (await unflaggedCell.textContent()) ?? "";
	expect(unflaggedText.length).toBeGreaterThan(0);

	await picker.locator(".emojiToneDefault").click();
	const popup = page.locator(".emojiTonePopup");
	await expect(popup).toBeVisible();
	await popup.locator(".emojiToneSwatch").nth(3).click();

	await expect(flaggedCell).toHaveText(`👋${MEDIUM_TONE}`);
	await expect(unflaggedCell).toHaveText(unflaggedText);
	await expect(unflaggedCell).not.toContainText(MEDIUM_TONE);
});

test("picked skin tone persists across reload when reopening the picker", async ({page}) => {
	await loginAndOpenChannel(page);

	await page.locator("#emojiTB").click();
	const picker = page.locator(".emojiPicker");
	await expect(picker).toBeVisible();

	await picker.locator(".emojirow .emojiSelect", {hasText: "👋"}).click();
	const flaggedCell = picker.locator(".emojiBody .emojiSelect:has(.emojiToneBadge)").first();

	await picker.locator(".emojiToneDefault").click();
	await page.locator(".emojiTonePopup .emojiToneSwatch").nth(3).click();
	await expect(flaggedCell).toHaveText(`👋${MEDIUM_TONE}`);

	await page.reload();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
	await expect(page.locator("#emojiTB")).toBeVisible();

	await page.locator("#emojiTB").click();
	await expect(picker).toBeVisible();
	await picker.locator(".emojirow .emojiSelect", {hasText: "👋"}).click();
	await expect(picker.locator(".emojiBody .emojiSelect:has(.emojiToneBadge)").first()).toHaveText(
		`👋${MEDIUM_TONE}`,
	);
});

test("plain-clicking a flagged cell with a tone picked inserts the toned emoji into #typebox", async ({
	page,
}) => {
	await loginAndOpenChannel(page);

	await page.locator("#emojiTB").click();
	const picker = page.locator(".emojiPicker");
	await expect(picker).toBeVisible();

	await picker.locator(".emojiToneDefault").click();
	await page.locator(".emojiTonePopup .emojiToneSwatch").nth(3).click();

	await picker.locator(".emojirow .emojiSelect", {hasText: "👋"}).click();
	const flaggedCell = picker.locator(".emojiBody .emojiSelect:has(.emojiToneBadge)").first();
	await expect(flaggedCell).toHaveText(`👋${MEDIUM_TONE}`);
	await flaggedCell.click();

	await expect(picker).toHaveCount(0);
	await expect(page.locator("#typebox")).toHaveText(`👋${MEDIUM_TONE}`);
});

test("hovering a picker cell shows :name: in .emojiFooter and moving off the picker clears it", async ({
	page,
}) => {
	await loginAndOpenChannel(page);

	await page.locator("#emojiTB").click();
	const picker = page.locator(".emojiPicker");
	await expect(picker).toBeVisible();

	const footer = picker.locator(".emojiFooter");
	const firstCell = picker.locator(".emojiBody .emojiSelect").first();
	await expect(firstCell).toBeVisible();

	await firstCell.hover();
	await expect(footer).toHaveText(/^:.+:$/);

	await page.locator("#channelname").hover();
	await expect(footer).toHaveText("");
});
