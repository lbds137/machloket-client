import {expect, type Page} from "@playwright/test";
import {
	type CapturedRequest,
	DESKTOP,
	EN,
	MOCK_CHANNEL_ID,
	MOCK_SPOILER_MESSAGE,
	MOCK_SPOILER_MESSAGE_ID,
	MOCK_TEXT_MESSAGE_ID,
	expectRequests,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// Discord parity: an edit emptied out (the message has no attachments) opens the
// delete confirm on Enter instead of saving. The mock mirrors the real server's
// refusal of whitespace-only content for a message with no other content (400 50006),
// so a save that still went out would show a refusal, never this dialog.

// deleteConfirm, yes and no sit at the top level of en.json, outside EN's two-level shape.
const dialogButtons = EN as unknown as {
	deleteConfirm: string;
	yes: string;
	no: string;
};
const deleteConfirm = dialogButtons.deleteConfirm;

const editBox = (page: Page) => page.locator(".messageEditContainer .editMessage");

const patchOnMessage =
	(messageId: string) =>
	(req: CapturedRequest): boolean =>
		req.method === "PATCH" &&
		req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages/${messageId}`;

/** Opens the editor of the message named by its text (hover -> the edit button). */
async function openEdit(page: Page, text: string) {
	const message = page.locator(".messagediv", {hasText: text});
	await message.hover();
	await message.locator(".messageButtons .svg-edit").click();
	const box = editBox(page);
	await expect(box).toBeVisible();
	return box;
}

test.use({...DESKTOP});

test.describe("a text message", () => {
	const welcome = "Welcome to the mock guild!";

	test("an edit emptied out offers to delete, and saves nothing", async ({
		page,
		mockInstance,
	}) => {
		await loginAndOpenChannel(page);
		const box = await openEdit(page, welcome);
		await box.fill("");
		await page.keyboard.press("Enter");

		const confirm = page.locator(".dialogModal", {hasText: deleteConfirm});
		await expect(confirm).toBeVisible();
		await expectRequests(mockInstance, patchOnMessage(MOCK_TEXT_MESSAGE_ID), 0);
		await expect(page.locator(".messageEditContainer")).toHaveCount(0);
	});

	test("an edit emptied to whitespace offers to delete too", async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		const box = await openEdit(page, welcome);
		await box.fill("   ");
		await page.keyboard.press("Enter");

		const confirm = page.locator(".dialogModal", {hasText: deleteConfirm});
		await expect(confirm).toBeVisible();
		await expectRequests(mockInstance, patchOnMessage(MOCK_TEXT_MESSAGE_ID), 0);
		await expect(page.locator(".messageEditContainer")).toHaveCount(0);
	});

	test("a normal edit still saves", async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		const box = await openEdit(page, welcome);
		const edited = `${welcome} (now with feeling)`;
		await box.fill(edited);
		await page.keyboard.press("Enter");

		const patches = await expectRequests(mockInstance, patchOnMessage(MOCK_TEXT_MESSAGE_ID), 1);
		expect(patches[0].body).toEqual({content: edited});
		await expect(page.locator(".messageEditContainer")).toHaveCount(0);
		await expect(page.locator(".dialogModal", {hasText: deleteConfirm})).toHaveCount(0);
	});

	test("the confirm's No keeps the message and its text", async ({page, mockInstance}) => {
		void mockInstance; // mount the mock's routes; the handle stays unread
		await loginAndOpenChannel(page);
		const box = await openEdit(page, welcome);
		await box.fill("");
		await page.keyboard.press("Enter");
		const confirm = page.locator(".dialogModal", {hasText: deleteConfirm});
		await confirm.getByRole("button", {name: dialogButtons.no, exact: true}).click();
		await expect(page.locator(".dialogModal")).toHaveCount(0);
		await expect(page.locator(".messagediv", {hasText: welcome})).toBeVisible();
		// A re-edit opens with the message's own text: no emptied draft was kept.
		const box2 = await openEdit(page, welcome);
		await expect(box2).toHaveText(welcome);
	});

	test("the confirm's Yes deletes the message", async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		const box = await openEdit(page, welcome);
		await box.fill("");
		await page.keyboard.press("Enter");
		const confirm = page.locator(".dialogModal", {hasText: deleteConfirm});
		await confirm.getByRole("button", {name: dialogButtons.yes, exact: true}).click();
		await expectRequests(
			mockInstance,
			(req) =>
				req.method === "DELETE" &&
				req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages/${MOCK_TEXT_MESSAGE_ID}`,
			1,
		);
		// The mock echoes MESSAGE_DELETE, so the bubble leaves the DOM too.
		await expect(page.locator(".messagediv", {hasText: welcome})).toHaveCount(0);
	});
});

test.describe("a message with attachments", () => {
	test.use({mockInstanceOptions: {messages: [MOCK_SPOILER_MESSAGE]}});

	test("an edit emptied out still saves", async ({
		page,
		mockInstance,
	}) => {
		await loginAndOpenChannel(page);
		const box = await openEdit(page, MOCK_SPOILER_MESSAGE.content);
		await box.fill("");
		const answered = page.waitForResponse(
			(res) =>
				res.request().method() === "PATCH" &&
				new URL(res.url()).pathname.endsWith(`/messages/${MOCK_SPOILER_MESSAGE_ID}`),
		);
		await page.keyboard.press("Enter");

		// The attachment stays content of its own: the emptied edit saves and closes the editor
		// with no delete confirm or refusal dialog. The answer's status is the positive signal:
		// the editor closes at once on Enter, so the count-0 checks alone could pass before a
		// refusal reached the page.
		expect((await answered).status()).toBe(200);
		const patches = await expectRequests(mockInstance, patchOnMessage(MOCK_SPOILER_MESSAGE_ID), 1);
		expect(patches[0].body).toEqual({content: ""});
		await expect(page.locator(".dialogModal")).toHaveCount(0);
		await expect(page.locator(".messageEditContainer")).toHaveCount(0);
	});
});
