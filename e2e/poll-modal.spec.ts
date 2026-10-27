import {expect} from "@playwright/test";
import {
	ANSWER_MAX_CHARS,
	MAX_ANSWERS,
	MIN_ANSWERS,
	QUESTION_MAX_CHARS,
} from "../src/webpage/utils/pollValidation";
import {MOCK_CHANNEL_ID, expectRequests, loginAndOpenChannel, test} from "./fixtures";

test.describe("poll modal validation (SEND_POLLS granted)", () => {
	test.use({mockInstanceOptions: {extraEveryonePermissions: ["SEND_POLLS"]}});

	test("gates submit on validation, caps question/answer lengths live, and clamps answer rows between MIN and MAX", async ({
		page,
		mockInstance,
	}) => {
		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		await page.locator("#upload").click();
		const menu = page.locator(".contextmenu");
		await expect(menu).toBeVisible();
		await menu.locator(".contextbutton", {hasText: "Make poll"}).click();

		const dialog = page.locator(".dialogModal");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("heading", {name: "Make poll", exact: true})).toBeVisible();

		const questionInput = dialog
			.locator(".optionElement", {has: page.getByText("Question:", {exact: true})})
			.locator("input");
		const answerInputs = dialog.locator(".pollAnsM input[type='text']");
		const deleteButtons = dialog.locator(".pollAnsM .svg-delete");
		const status = dialog.locator(".pollStatus");
		const maxHint = dialog.locator(".pollMaxHint");
		const newAnswerBtn = dialog.getByRole("button", {name: "New Answer", exact: true});
		const submitBtn = dialog.getByRole("button", {name: "Submit", exact: true});

		// Pristine modal: submit disabled, status shows empty-question refusal, 2 answer rows with delete disabled at MIN.
		await expect(submitBtn).toBeDisabled();
		await expect(status).toHaveText("Please enter a question");
		await expect(answerInputs).toHaveCount(MIN_ANSWERS);
		await expect(deleteButtons).toHaveCount(MIN_ANSWERS);
		await expect(deleteButtons.nth(0)).toBeDisabled();
		await expect(deleteButtons.nth(1)).toBeDisabled();

		// Clicking a disabled delete at MIN never drops below 2 rows.
		await deleteButtons.nth(0).click({force: true});
		await expect(answerInputs).toHaveCount(MIN_ANSWERS);

		// Typing a question + 2 answers enables submit and clears the status refusal.
		await questionInput.fill("What is for lunch?");
		await expect(submitBtn).toBeDisabled();
		await expect(status).toHaveText("Please fill in all answers");

		await answerInputs.nth(0).fill("Tacos");
		await expect(submitBtn).toBeDisabled();

		await answerInputs.nth(1).fill("Pizza");
		await expect(submitBtn).toBeEnabled();
		await expect(status).toHaveText("");

		// The answer input truncates live (plain input + slice). The question's maxLength
		// caps it at the DOM level: fill() inserts like a user, so 310 chars LAND as 300 and
		// no refusal can fire through the UI (the refusal path is unit-pinned via direct
		// .value assignment, which bypasses maxLength).
		await answerInputs.nth(0).fill("a".repeat(ANSWER_MAX_CHARS + 10));
		await expect(answerInputs.nth(0)).toHaveValue("a".repeat(ANSWER_MAX_CHARS));

		await questionInput.fill("q".repeat(QUESTION_MAX_CHARS + 10));
		await expect(questionInput).toHaveValue("q".repeat(QUESTION_MAX_CHARS));
		await expect(submitBtn).toBeEnabled();

		// Restore readable values before testing row bounds.
		await questionInput.fill("What is for lunch?");
		await answerInputs.nth(0).fill("Tacos");
		await expect(submitBtn).toBeEnabled();

		// Adding rows up to MAX_ANSWERS enables delete and disables "New Answer" at MAX with hint.
		for (let count = MIN_ANSWERS; count < MAX_ANSWERS; count++) {
			await expect(newAnswerBtn).toBeEnabled();
			await newAnswerBtn.click();
		}
		await expect(answerInputs).toHaveCount(MAX_ANSWERS);
		await expect(newAnswerBtn).toBeDisabled();
		await expect(maxHint).toHaveText("You can add up to 10 options");
		await expect(deleteButtons.nth(0)).toBeEnabled();
		// Newly added answers are empty, so submit is gated again.
		await expect(submitBtn).toBeDisabled();
		await expect(status).toHaveText("Please fill in all answers");

		// Deleting back down to MIN_ANSWERS re-enables "New Answer", re-disables delete at MIN, and re-enables submit.
		for (let count = MAX_ANSWERS; count > MIN_ANSWERS; count--) {
			await deleteButtons.nth(count - 1).click();
		}
		await expect(answerInputs).toHaveCount(MIN_ANSWERS);
		await expect(newAnswerBtn).toBeEnabled();
		await expect(maxHint).toBeHidden();
		await expect(deleteButtons.nth(0)).toBeDisabled();
		await expect(deleteButtons.nth(1)).toBeDisabled();
		await expect(submitBtn).toBeEnabled();

		// Submitting sends the poll payload and closes the modal.
		await submitBtn.click();
		await expect(dialog).toBeHidden();
		const sent = await expectRequests(
			mockInstance,
			(req) => req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`,
			1,
		);
		expect(sent[0].body).toMatchObject({
			content: "",
			poll: {
				question: {text: "What is for lunch?"},
				answers: [{poll_media: {text: "Tacos"}}, {poll_media: {text: "Pizza"}}],
				duration: 24,
				allow_multiselect: false,
			},
		});
	});
});

test('default mount without SEND_POLLS omits "Make poll" and never opens the poll modal', async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#upload").click();
	const menu = page.locator(".contextmenu");
	await expect(menu).toBeVisible();
	await expect(menu.locator(".contextbutton", {hasText: "Upload"})).toBeVisible();
	await expect(menu.locator(".contextbutton", {hasText: "Make poll"})).toHaveCount(0);
	await expect(page.locator(".dialogModal")).toHaveCount(0);
});
