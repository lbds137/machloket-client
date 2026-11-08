import {expect} from "@playwright/test";
import {
	EN,
	MOCK_ARCHIVED_THREAD,
	MOCK_CHANNEL,
	MOCK_GUILD_ID,
	loginAndOpenChannel,
	test,
} from "./fixtures";

test.use({mockInstanceOptions: {archivedThread: true}});

test("an archived thread shows the unavailable hint and no command rows", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}/${MOCK_ARCHIVED_THREAD.id}`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_ARCHIVED_THREAD.name);
	// Not about the hint: on the phone layout the composer sits off canvas until the
	// deep-link landing slides the chat in, so this waits for that open before typing.
	await expect(page.locator("#page")).toHaveClass(/mobileMainOpen/);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially("/");

	const popup = page.locator("#searchOptions");
	expect(EN.guild.slashArchived).toBe("Commands are unavailable in archived threads.");
	// The hint first: the gate already refuses every command here, so without the hint the
	// popup has nothing to show and stays hidden.
	await expect(popup.locator(".commandArchivedHint")).toHaveText(EN.guild.slashArchived);
	await expect(popup).toBeVisible();
	await expect(popup.locator(".commandRow")).toHaveCount(0);
	await expect(popup).not.toContainText("e2evisible");
});

test("the parent text channel still lists commands and shows no archived hint", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially("/");

	const popup = page.locator("#searchOptions");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("e2evisible");
	await expect(popup).not.toContainText("e2eadminonly");
	await expect(popup).not.toContainText("e2edenied");
	await expect(popup.locator(".commandRow")).toHaveCount(1);
	await expect(popup.locator(".commandArchivedHint")).toHaveCount(0);
});
