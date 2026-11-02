import {expect} from "@playwright/test";
import {DESKTOP, MOCK_CHANNEL, loginAndOpenChannel, test} from "./fixtures";

// Tapping a channel's row while that channel is still loading: the guild's tile opens its
// channel, and the row is the next tap. Only a slow answer keeps the first build in flight,
// so the test holds the page's message fetch until both taps are in.

test("re-tapping a channel still loading doesn't leave its skeleton up", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(`**/channels/${MOCK_CHANNEL.id}/messages?*`, async (route) => {
		await held;
		await route.fallback();
	});

	await loginAndOpenChannel(page);
	await expect(page.locator("#loadingdiv")).toHaveClass(/loading/);
	release();

	await expect(page.locator("#loadingdiv")).not.toHaveClass(/loading/);
	await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
});

// The channel being left abandons its build, and a panel channel builds no messages of its own.
// Desktop: on a phone the skeleton covers the sidebar, so another row isn't the next tap.
test.describe("on desktop", () => {
	test.use(DESKTOP);

	test("leaving a channel still loading for a panel channel takes its skeleton down", async ({
		page,
		mockInstance,
	}) => {
		void mockInstance; // mount the mock's routes; the handle stays unread
		await page.route(`**/channels/${MOCK_CHANNEL.id}/messages?*`, () => {
			// Never answered: the channel is left while its fetch is still out.
		});

		await loginAndOpenChannel(page);
		await expect(page.locator("#loadingdiv")).toHaveClass(/loading/);
		await page.locator("#channels button.channelbutton", {hasText: "after-dark"}).click();

		await expect(page.locator("#scrollWrap")).toContainText(
			"This is a NSFW channel, do you wish to proceed?",
		);
		await expect(page.locator("#loadingdiv")).not.toHaveClass(/loading/);
	});
});
