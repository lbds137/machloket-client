import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// A refused send says why, above the composer (Channel.showSendError): an invalid-form body
// (50035) spells out the field's own message. The body is messageSend.test.ts's
// "spells out an invalid-form refusal"; here it runs through the built app at phone width,
// where Enter doesn't send and #mobileSend does.
test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

test("a sent message empties the composer and takes the send button with it", async ({page}) => {
	await loginAndOpenChannel(page);
	const composer = page.locator(".outerTypeBox");
	await expect(composer).toHaveClass(/noConent/);

	await page.locator("#typebox").click();
	await page.keyboard.type("a message that goes out");
	await expect(composer).not.toHaveClass(/noConent/);
	await page.locator("#mobileSend").tap();

	await expect(page.locator("#typebox")).toHaveText("");
	await expect(composer).toHaveClass(/noConent/);
});

test("the same text typed again right after a tap-send still shows the send button", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	const composer = page.locator(".outerTypeBox");
	const typebox = page.locator("#typebox");

	await typebox.click();
	await page.keyboard.type("k");
	await expect(composer).not.toHaveClass(/noConent/);
	await page.locator("#mobileSend").tap();
	await expect(composer).toHaveClass(/noConent/);

	await typebox.click();
	await page.keyboard.type("k");
	await expect(typebox).toHaveText("k");
	await expect(composer).not.toHaveClass(/noConent/);
});

test("a too-long message's refusal is spelled out in a notice above the composer", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	await page.route("**/api/v9/channels/*/messages", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		await route.fulfill({
			status: 400,
			json: {
				code: 50035,
				message: "Invalid Form Body",
				errors: {
					content: {
						_errors: [{code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length."}],
					},
				},
			},
		});
	});

	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.type("a message the server refuses");
	await page.locator("#mobileSend").tap();

	const notice = page.locator("#realbox .sendError");
	await expect(notice).toHaveText("Must be 2000 or fewer in length.");
	await expect(notice).toBeVisible();
	await expect(notice).toBeInViewport({ratio: 1});

	// Above the composer: the notice sits over the text box, and the refused text is back in it.
	const noticeBox = (await notice.boundingBox())!;
	const typeboxBox = (await typebox.boundingBox())!;
	expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(typeboxBox.y + 1);
	await expect(typebox).toHaveText("a message the server refuses");
});
