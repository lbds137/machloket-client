import {expect} from "@playwright/test";
import {
	MOCK_BOT_USER,
	MOCK_BOT_USER_ID,
	MOCK_CHANNEL_ID,
	expectRequests,
	loginAndOpenChannel,
	test,
} from "./fixtures";

test("sending a typed @name resolves a unique member to <@id> and leaves an unknown name literal", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await expect(page.getByText("Welcome to the mock guild!", {exact: true})).toBeVisible();

	const isSend = (req: {method: string; pathname: string}) =>
		req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`;

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.fill(`@${MOCK_BOT_USER.username} hello`);
	await page.locator("#mobileSend").tap();

	const firstSends = await expectRequests(mockInstance, isSend, 1);
	expect((firstSends[0].body as {content: string}).content).toBe(`<@${MOCK_BOT_USER_ID}> hello`);

	await typebox.click();
	await typebox.fill("@Nobody hi");
	await page.locator("#mobileSend").tap();

	const secondSends = await expectRequests(mockInstance, isSend, 2);
	expect((secondSends[1].body as {content: string}).content).toBe("@Nobody hi");
});
