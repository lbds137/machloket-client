import {expect} from "@playwright/test";
import {
	MOCK_CHANNEL_ID,
	MOCK_TEXT_MESSAGE_ID,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// The forward flow (walk item: view the forward card, send one via the context menu).
// Two halves: the card a forwarded message renders (header "Forwarded" + source channel,
// body from the message snapshot), and the send path (right-click a message -> Forward ->
// the "Forward to" channel picker -> the POST carries the source id with content "").

test("a forwarded message renders its card from the snapshot", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const card = page.locator(".forwardBlock");
	await expect(card).toHaveCount(1);
	await expect(card.locator(".forwardHeader")).toContainText("Forwarded");
	await expect(card.locator(".forwardHeader")).toContainText("#general");
	await expect(
		card.locator(".forwardBody"),
		"the snapshot body renders verbatim",
	).toContainText("Forwarded from earlier: the original answer, kept verbatim.");

	// The card's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(card).toHaveScreenshot("forward-card.png");
});

test("right-click -> Forward sends through the picker with the source reference", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);

	await page
		.locator(".messagediv", {hasText: "Welcome to the mock guild!"})
		.click({button: "right"});

	// The context menu's item — exact text, so the forward card's "Forwarded" label
	// elsewhere in the channel never matches.
	await page.getByText("Forward", {exact: true}).click();

	const picker = page.locator(".dialogModal");
	await expect(picker).toContainText("Forward to");
	await expect(picker).toContainText("general");

	// The only candidate channel row sends the forward and closes the dialog.
	await picker.locator(".friendGroupSelect .flexltr").first().click();

	// The Dialog leaves the DOM asynchronously (removeAni's fade); toBeHidden passes
	// both before and after detach.
	await expect(picker).toBeHidden();

	const sends = mockInstance.capturedRequests.filter(
		(req) => req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`,
	);
	expect(sends.length).toBe(1);
	expect(sends[0].body).toEqual({
		content: "",
		message_reference: {type: 1, message_id: MOCK_TEXT_MESSAGE_ID},
	});
});
