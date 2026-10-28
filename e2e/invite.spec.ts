import {expect} from "@playwright/test";
import {
	type CapturedRequest,
	expectRequests,
	loginAndOpenChannel,
	MOCK_INVITE_CODE,
	MOCK_INSTANCE_ORIGIN,
	MOCK_TOKEN,
	pinShot,
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
	await pinShot(page.locator("#invitebody"), "invite-page.png");

	// Accept → the account switcher → the (only matching) account → the join POST.
	const isJoin = (req: CapturedRequest) =>
		req.method === "POST" && req.pathname === `/api/v9/invites/${MOCK_INVITE_CODE}`;
	await page.locator("#AcceptInvite").click();
	const row = page.locator(".switchtable", {hasText: "testuser"});
	await expect(row).toHaveCount(1);
	// Nothing joins until an account is picked.
	expect(mockInstance.capturedRequests.filter(isJoin)).toHaveLength(0);
	await row.click();

	// The join went out with the picked account's token, and the page navigated into the
	// accepted guild.
	const [join] = await expectRequests(mockInstance, isJoin, 1);
	expect(join.authorization, "the join carries the picked account's token").toBe(MOCK_TOKEN);
	await expect(page).toHaveURL(/\/channels\/1200000000000000100/);

	// The accept must LAND the user in the guild's channel view: the boot auto-opens the
	// guild's channel (Discord's invite behavior), not a channelless holding state.
	await expect(page.locator("#channelname")).toHaveText("#general");
});
