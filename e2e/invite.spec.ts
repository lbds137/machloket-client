import {expect} from "@playwright/test";
import {
	MOCK_GUILD_ID,
	MOCK_INSTANCE_ORIGIN,
	MOCK_INVITE_CODE,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// The invite page (walk item 1c's mockable half): /invite/:code?instance=… previews the
// guild from the instance's answer, and Accept joins through the account switcher into
// the guild's channel view. Notification tap-through (1d) and PWA install stay physical.

test("the invite page previews the guild, and accept lands in it", async ({
	page,
	mockInstance,
}) => {
	// A logged-in account first: the page's joinable list comes from stored accounts
	// whose instance matches ?instance=.
	await loginAndOpenChannel(page);

	await page.goto(`/invite/${MOCK_INVITE_CODE}?instance=${MOCK_INSTANCE_ORIGIN}`);

	// The preview: guild name, invited-by line, and the Accept button.
	await expect(page.locator("#invitename")).toHaveText("Mock Guild");
	await expect(page.locator("#invitedescription")).toContainText("HelperBot");
	await expect(page.locator("#AcceptInvite")).toBeVisible();

	// The page's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(page.locator("#invitebody")).toHaveScreenshot("invite-page.png");

	// Accept → the account switcher → the (only matching) account → the join POST.
	await page.locator("#AcceptInvite").click();
	const row = page.locator(".switchtable", {hasText: "testuser"});
	await expect(row).toHaveCount(1);
	await row.click();

	// The join went out, and the page navigated into the accepted guild.
	const joins = mockInstance.capturedRequests.filter(
		(req) => req.method === "POST" && req.pathname === `/api/v9/invites/${MOCK_INVITE_CODE}`,
	);
	expect(joins.length).toBe(1);
	await expect(page).toHaveURL(new RegExp(`/channels/${MOCK_GUILD_ID}$`));
	// Where the app lands after this navigation is the boot's business, not the page's:
	// a bare /channels/:guildId boot currently resolves to the guild's noChannel state
	// ("Weird spot", no channel auto-picked) — repro'd on the mock, FILED red-first.
	// This spec pins the invite page's contract up to the handoff. When the fix makes
	// the boot auto-open a channel, the URL gains a /<channelId> segment and this $-
	// anchored assert gets updated with it.
});
