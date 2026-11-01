import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// A real pointer drag, not a synthetic drop event: dropping a channel row where it started must
// leave it listed and send no reorder. The sibling drop is the positive control that this
// gesture really runs the app's drag and drop here.
test.use({
	viewport: {width: 1280, height: 800},
	mockInstanceOptions: {extraEveryonePermissions: ["MANAGE_CHANNELS"]},
});

const row = (page: Page, name: string) =>
	page.locator("#channels button.channelbutton", {hasText: name});

/** Presses on `from`, leaves it far enough to start a drag, and releases on `to`. */
async function drag(page: Page, from: string, to: string) {
	const start = (await row(page, from).boundingBox())!;
	const end = (await row(page, to).boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(start.x + start.width / 2 + 30, start.y + start.height + 40, {steps: 5});
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 4, {steps: 5});
	await page.mouse.up();
}

test("a channel dropped where it started stays listed and sends no reorder", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	const reorders = () =>
		mockInstance.capturedRequests.filter(
			(req) => req.method === "PATCH" && req.pathname.endsWith("/channels"),
		);

	await drag(page, "after-dark", "after-dark");
	await new Promise((resolve) => setTimeout(resolve, 300));

	expect(reorders()).toEqual([]);
	await expect(row(page, "after-dark")).toBeVisible();

	// Control: the same gesture onto another row is a real reorder.
	await drag(page, "after-dark", "general");
	await expect.poll(() => reorders().length, "a sibling drop reaches the mock").toBe(1);
});
