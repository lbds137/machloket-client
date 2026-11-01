import {expect, type Page} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";
import {MOCK_CHANNEL_ID, MOCK_GUILD_ID, MOCK_USER} from "./mock";

// A refused send the composer can't take back stays in its channel as a failed message with
// Retry and Delete. These run the real bubble and scroller: the unit tests mock the bubble.
test.use({viewport: {width: 1280, height: 800}});

/** Holds the next message POST until the returned function refuses it. */
async function holdSend(page: Page) {
	let refuse = () => {};
	const released = new Promise<void>((resolve) => {
		refuse = resolve;
	});
	await page.route("**/api/v9/channels/*/messages", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		await released;
		await route.fulfill({status: 403, json: {code: 50013, message: "Missing Permissions"}});
	});
	return refuse;
}

const channelRow = (page: Page, name: string) =>
	page.locator("#channels button.channelbutton", {hasText: name});

test("typing after a send: the refused message stays, failed, with Retry", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);
	const refuse = await holdSend(page);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.type("first message");
	await page.keyboard.press("Enter");
	await expect(page.locator("#scrollWrap")).toContainText("first message");
	await page.keyboard.type("still typing");
	refuse();

	const failed = page.locator(".erroredMessage", {hasText: "first message"});
	await expect(failed).toBeVisible();
	await expect(failed.getByRole("button", {name: "Resend errored message"})).toBeVisible();

	await failed.getByRole("button", {name: "Delete message"}).click();
	await expect(page.locator("#scrollWrap")).not.toContainText("first message");
});

test("changing channel after a send: the refused message is there when you come back", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);
	const refuse = await holdSend(page);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.type("first message");
	await page.keyboard.press("Enter");
	await expect(page.locator("#scrollWrap")).toContainText("first message");
	// A draft left behind means the refused text can't come back as the draft.
	await page.keyboard.type("a draft");
	await channelRow(page, "after-dark").click();
	refuse();
	await channelRow(page, "general").click();

	const failed = page.locator(".erroredMessage", {hasText: "first message"});
	await expect(failed).toBeVisible();
	await expect(failed.getByRole("button", {name: "Resend errored message"})).toBeVisible();
});

test("a send the gateway already delivered gets no failed bubble when its request errors", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	let nonce = "";
	let abort = () => {};
	const aborted = new Promise<void>((resolve) => {
		abort = resolve;
	});
	await page.route("**/api/v9/channels/*/messages", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		nonce = (route.request().postDataJSON() as {nonce: string}).nonce;
		await aborted;
		await route.abort();
	});

	await page.locator("#typebox").click();
	await page.keyboard.type("first message");
	await page.keyboard.press("Enter");
	await expect.poll(() => nonce).not.toBe("");

	mockInstance.sendGatewayEvent({
		op: 0,
		t: "MESSAGE_CREATE",
		d: {
			id: "1300000000000000999",
			channel_id: MOCK_CHANNEL_ID,
			guild_id: MOCK_GUILD_ID,
			author: MOCK_USER,
			content: "first message",
			timestamp: new Date().toISOString(),
			edited_timestamp: null,
			mentions: [],
			mention_roles: [],
			mention_everyone: false,
			attachments: [],
			embeds: [],
			reactions: [],
			tts: false,
			pinned: false,
			type: 0,
			nonce,
		},
	});
	await expect(page.locator(".messagediv:not(.loadingMessage)", {hasText: "first message"})).toHaveCount(1);
	abort();
	await new Promise((resolve) => setTimeout(resolve, 500));

	await expect(page.locator(".erroredMessage")).toHaveCount(0);
	await expect(page.locator(".messagediv", {hasText: "first message"})).toHaveCount(1);
});

test("a refusal that arrives late does not pull the view down from history", async ({
	page,
	mockInstance,
}) => {
	{
		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);
		// After login, which needs the room: short enough that the channel has to scroll.
		await page.setViewportSize({width: 1280, height: 320});
		const refuse = await holdSend(page);

		await page.locator("#typebox").click();
		await page.keyboard.type("first message");
		await page.keyboard.press("Enter");
		await page.keyboard.type("still typing");
		const oldest = page.locator(".messagediv").first();
		await oldest.scrollIntoViewIfNeeded();
		await expect(oldest).toBeInViewport();
		refuse();
		await expect(page.getByRole("alert")).toContainText("Missing Permissions");
		await new Promise((resolve) => setTimeout(resolve, 300));

		await expect(oldest).toBeInViewport();
	}
});
