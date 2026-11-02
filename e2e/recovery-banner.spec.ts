import {expect, type Page} from "@playwright/test";
import {DESKTOP, loginAndOpenChannel, pinShot, test} from "./fixtures";

// The warning that someone asked to remove this account's second factors: it takes room from
// the app instead of covering it, on both layouts, and reads gateway frames through the real
// socket path. What the server answers is e2e-real/mfa-recovery.spec.ts; the rendering is here.
const ROUTE = "**/api/v9/users/@me/mfa/recovery";
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

interface Stub {
	gets: number;
	deletes: number;
	deleteStatus: number;
}

/** Answers the route with a pending request until a DELETE is accepted. */
async function stubRecovery(page: Page, completesAt: string | null): Promise<Stub> {
	const stub: Stub = {gets: 0, deletes: 0, deleteStatus: 204};
	let pending = true;
	await page.route(ROUTE, (route) => {
		if (route.request().method() === "DELETE") {
			stub.deletes++;
			if (stub.deleteStatus === 204) pending = false;
			return route.fulfill({status: stub.deleteStatus, json: {}});
		}
		stub.gets++;
		return pending
			? route.fulfill({json: {status: "pending", completes_at: completesAt}})
			: route.fulfill({status: 404, json: {message: "No pending MFA recovery request"}});
	});
	return stub;
}

/** The bar sits on top, and the app fills exactly what's left of the screen. */
async function expectRoomMade(page: Page): Promise<void> {
	const viewport = page.viewportSize()!;
	const bar = (await page.locator("#recoveryBanner").boundingBox())!;
	expect(bar.y).toBe(0);
	expect(bar.height).toBeGreaterThan(0);
	expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width);

	const app = (await page.locator("#page").boundingBox())!;
	expect(app.y).toBeCloseTo(bar.height, 0);
	expect(app.y + app.height).toBeCloseTo(viewport.height, 0);

	const main = (await page.locator("#mainarea").boundingBox())!;
	expect(main.y).toBeGreaterThanOrEqual(bar.height - 1);
	expect(main.y + main.height).toBeLessThanOrEqual(viewport.height + 1);
	await expect(page.locator("#typebox")).toBeInViewport({ratio: 1});
}

async function expectFullScreenApp(page: Page): Promise<void> {
	const viewport = page.viewportSize()!;
	const app = (await page.locator("#page").boundingBox())!;
	expect(app.y).toBe(0);
	expect(app.height).toBeCloseTo(viewport.height, 0);
}

test("with no request pending there's no bar and the app has the whole screen", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	await expect(page.locator("#recoveryBanner")).toBeHidden();
	await expectFullScreenApp(page);
});

test("a running hold warns on the phone's chat and channel list, with its date and time left", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	// A fixed clock: the date is in the shot below.
	await page.clock.setFixedTime(new Date("2026-11-02T12:00:00Z"));
	await stubRecovery(page, "2026-11-05T12:00:00Z");
	await loginAndOpenChannel(page);

	const bar = page.locator("#recoveryBanner");
	await expect(bar).toBeVisible();
	await expect(bar).toContainText("Someone asked to remove two-factor authentication");
	await expect(bar).toContainText("signed out everywhere");
	await expect(page.locator("#recoveryBannerWhen")).toHaveText("in 72 hours");
	await expect(bar.getByRole("button", {name: "Cancel removal"})).toBeInViewport({ratio: 1});
	await expectRoomMade(page);

	// The screen a phone rests on: the bar can't live inside the chat pane.
	await page.locator("#maintoggleicon").tap();
	await expect(page.locator("#maintoggle")).not.toBeChecked();
	await expect(bar).toBeInViewport({ratio: 1});
	const barBox = (await bar.boundingBox())!;
	const list = (await page.locator(".channelflex").boundingBox())!;
	expect(list.y).toBeGreaterThanOrEqual(barBox.height - 1);

	await pinShot(bar, "recovery-bar.png");
});

test("the phone's full-screen search leaves the warning and its button reachable", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await stubRecovery(page, inDays(3));
	await loginAndOpenChannel(page);
	const bar = page.locator("#recoveryBanner");
	await expect(bar).toBeVisible();

	// The view's own opening gesture isn't this spec's subject; its layout rule is.
	await page.locator("#page").evaluate((el) => el.classList.add("mobileSearchOpen"));
	const barBox = (await bar.boundingBox())!;
	const search = (await page.locator("#sideContainDiv").boundingBox())!;
	expect(search.y).toBeGreaterThanOrEqual(barBox.height - 1);
});

test("a hold whose notice isn't out yet warns with no countdown", async ({page, mockInstance}) => {
	void mockInstance;
	await stubRecovery(page, null);
	await loginAndOpenChannel(page);

	const bar = page.locator("#recoveryBanner");
	await expect(bar).toContainText("If this wasn't you, cancel it now.");
	await expect(bar).not.toContainText("signed out everywhere");
	await expect(page.locator("#recoveryBannerWhen")).toBeHidden();
});

test("cancelling sends the DELETE, and the app takes the room back", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const stub = await stubRecovery(page, inDays(3));
	await loginAndOpenChannel(page);

	await page.getByRole("button", {name: "Cancel removal"}).tap();
	await expect(page.locator("#recoveryBanner")).toBeHidden();
	expect(stub.deletes).toBe(1);
	await expectFullScreenApp(page);
});

test("a refused cancel says so and leaves the warning and its button up", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const stub = await stubRecovery(page, inDays(3));
	stub.deleteStatus = 500;
	await loginAndOpenChannel(page);

	const button = page.getByRole("button", {name: "Cancel removal"});
	await button.tap();
	await expect(page.locator("#recoveryBannerError")).toHaveText("Couldn't cancel it. Try again.");
	await expect(page.locator("#recoveryBanner")).toBeVisible();
	await expect(button).toBeEnabled();
	await expectRoomMade(page);
});

test("gateway frames raise and clear the warning on a running session", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	const bar = page.locator("#recoveryBanner");
	await expect(bar).toBeHidden();

	const update = (d: unknown) =>
		mockInstance.sendGatewayEvent({op: 0, t: "MFA_RECOVERY_UPDATE", d});

	update({status: "pending", completes_at: inDays(3)});
	await expect(bar).toBeVisible();
	await expect(page.locator("#recoveryBannerWhen")).toHaveText("in 72 hours");
	await expectRoomMade(page);

	update({status: "pending"});
	await expect(page.locator("#recoveryBannerWhen")).toBeHidden();

	update({status: "cancelled"});
	await expect(bar).toBeHidden();
	await expectFullScreenApp(page);

	update({status: "pending"});
	await expect(bar).toBeVisible();
	update({status: "completed"});
	await expect(bar).toBeHidden();
});

test("a resumed connection reads the state again, since a drop can miss an event", async ({
	page,
	mockInstance,
}) => {
	const stub = await stubRecovery(page, inDays(3));
	await loginAndOpenChannel(page);
	await expect(page.locator("#recoveryBanner")).toBeVisible();
	const before = stub.gets;

	mockInstance.sendGatewayEvent({op: 0, t: "RESUMED", d: {}});
	await expect.poll(() => stub.gets).toBe(before + 1);
});

test.describe("on a desktop", () => {
	test.use(DESKTOP);

	test("the bar spans the top and the app fills the rest", async ({page, mockInstance}) => {
		void mockInstance;
		await stubRecovery(page, inDays(3));
		await loginAndOpenChannel(page);

		await expect(page.locator("#recoveryBanner")).toBeVisible();
		await expectRoomMade(page);
		const bar = (await page.locator("#recoveryBanner").boundingBox())!;
		expect(bar.width).toBe(page.viewportSize()!.width);
	});
});
