import {expect} from "@playwright/test";
import {loginAndOpenChannel, pinShot, test} from "./fixtures";

// Walk item 1h mechanized: the slash popup's command list is permission-filtered. The
// fixture member holds VIEW/SEND/HISTORY but no ADMINISTRATOR (the @everyone role's
// bits): an open command shows, an admins-only one ("0" default_member_permissions)
// doesn't, and an explicit per-user deny in the command's permissions table doesn't
// either. This is the client's display filter only - the server enforces who may run a
// command, and a mock can't pin that.

test("the slash popup lists allowed commands and filters denied ones", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	// A name fragment searches the commands. The popup renders into #searchOptions above
	// the composer.
	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially("/e2e");

	const popup = page.locator("#searchOptions");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("e2evisible");
	await expect(popup).not.toContainText("e2eadminonly");
	await expect(popup).not.toContainText("e2edenied");

	// The popup's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await pinShot(popup, "slash-popup.png");
});

// The bare "/" browse panel is the other way in (renderCommandPanel, not the search
// branch): the same filter must hold there.
test("the bare slash browse panel filters the same way", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially("/");

	const popup = page.locator("#searchOptions");
	await expect(popup).toContainText("e2evisible");
	await expect(popup).not.toContainText("e2eadminonly");
	await expect(popup).not.toContainText("e2edenied");
});
