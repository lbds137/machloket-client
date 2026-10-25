import {expect} from "@playwright/test";
import {MOCK_INSTANCE_ORIGIN, expectRequests, loginAndOpenChannel, test} from "./fixtures";

// The failure half of the /invite/:code?instance=… preview (src/webpage/invite.ts): a 404 or a
// 200 without a guild marks the invite not found and removes #AcceptInvite; any other HTTP
// error writes requestFailed into #invitedescription and leaves #AcceptInvite up.

const INVITE_ROUTE = "**/api/v9/invites/deadcode";
const INVITE_URL = `/invite/deadcode?instance=${MOCK_INSTANCE_ORIGIN}`;

test("a dead invite says so and drops the Accept button", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	// Registered after mountMockInstance so this handler wins for deadcode over the mock's
	// catch-all GET /api/v9/invites/:code route.
	await page.route(INVITE_ROUTE, (route) =>
		route.fulfill({
			status: 404,
			contentType: "application/json",
			body: JSON.stringify({message: "Unknown Invite", code: 10006}),
		}),
	);

	await page.goto(INVITE_URL);

	await expect(page.locator("#AcceptInvite")).toHaveCount(0);
	await expect(page.locator("#invitename")).toHaveText("Invite could not be found");
	await expect(page.locator("#invitedescription")).toHaveText("");
});

test("a server failure keeps Accept and explains itself", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);

	// Only the preview fails; the join POST still reaches the mock.
	await page.route(INVITE_ROUTE, (route) =>
		route.request().method() === "GET"
			? route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({message: "boom"}),
				})
			: route.fallback(),
	);

	await page.goto(INVITE_URL);

	await expect(page.locator("#invitedescription")).toHaveText(
		"That didn't go through (HTTP 500). Try again in a moment.",
	);
	await expect(page.locator("#AcceptInvite")).toBeVisible();

	// Keeping Accept is the point: it still joins, and with no guild to name the join
	// lands on the home page.
	await page.locator("#AcceptInvite").click();
	await page.locator(".switchtable", {hasText: "testuser"}).click();
	await expectRequests(
		mockInstance,
		(req) => req.method === "POST" && req.pathname === "/api/v9/invites/deadcode",
		1,
	);
	await expect(page).toHaveURL(/\/channels\/@me$/, {timeout: 10_000});
});

test("an invite preview without a guild is a dead invite", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	// A 200 whose body carries no guild takes the same !json?.guild branch as a 404.
	await page.route(INVITE_ROUTE, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: "{}",
		}),
	);

	await page.goto(INVITE_URL);

	await expect(page.locator("#AcceptInvite")).toHaveCount(0);
	await expect(page.locator("#invitename")).toHaveText("Invite could not be found");
	await expect(page.locator("#invitedescription")).toHaveText("");
});
