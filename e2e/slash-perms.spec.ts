import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// Walk item 1h mechanized: the slash popup's command list is permission-filtered. The
// fixture member holds VIEW/SEND/HISTORY but no ADMINISTRATOR (the @everyone role's
// bits), so the pins are real filtering: an open command shows for "/" browsing, an
// admins-only one ("0" default_member_permissions) doesn't, and an explicit per-user
// deny in the command's permissions table doesn't either.

test("the slash popup lists allowed commands and filters denied ones", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	// Typing a bare "/" opens the browse panel; a name fragment narrows it. The popup
	// renders into #searchOptions above the composer.
	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially("/e2e");

	const popup = page.locator("#searchOptions");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("e2evisible");
	await expect(popup).not.toContainText("e2eadminonly");
	await expect(popup).not.toContainText("e2edenied");

	// The popup's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(popup).toHaveScreenshot("slash-popup.png");
});
