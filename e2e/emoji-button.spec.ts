import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// The composer's emoji button (`#emojiTB`, a bare span) must not disturb the composer's
// caret: its mousedown handler both prevents the default (which would move the document
// selection out of #typebox and leave saveCaretPosition reading the wrong caret) and
// stops propagation. Without the preventDefault the captured caret clamps to the box's
// full text and a picked emoji inserts at the END of the composed text instead of at
// the caret — on touch and mouse alike (probe + fix, emoji-composer-scope G, 10-27).
// The open tests pin that the picker opens through both pointer kinds with a caret in the box;
// the fresh-boot test below pins the variant with no selection at all (rangeCount 0).

for (const kind of ["mouse", "touch"] as const) {
	test(`emoji button opens the picker (${kind})`, async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		// Positive control that the mock actually armed (user-dock's pattern): without it
		// the boot fails on setup, not on the thing under test.
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		const typebox = page.locator("#typebox");
		if (kind === "touch") {
			await typebox.tap();
		} else {
			await typebox.click();
		}
		await page.keyboard.type("hello");

		const emojiTB = page.locator("#emojiTB");
		if (kind === "touch") {
			await emojiTB.tap();
		} else {
			await emojiTB.click();
		}
		await expect(page.locator(".emojiPicker")).toBeVisible();
	});
}

for (const kind of ["mouse", "touch"] as const) {
	test(`a picked emoji lands at a mid-text caret (${kind})`, async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

		const typebox = page.locator("#typebox");
		if (kind === "touch") {
			await typebox.tap();
		} else {
			await typebox.click();
		}
		await page.keyboard.type("hello world");
		// Caret between "hello " and "world" (index 6): 5 ArrowLeft from the end.
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press("ArrowLeft");
		}

		const emojiTB = page.locator("#emojiTB");
		if (kind === "touch") {
			await emojiTB.tap();
		} else {
			await emojiTB.click();
		}
		await expect(page.locator(".emojiPicker")).toBeVisible();

		// Body rows only: .emojiSelect also matches the guild rail icons, which re-render
		// the body instead of resolving the picker.
		await page.locator(".emojiPicker .emojiBody .emojiSelect").first().click();
		await expect
			.poll(() => typebox.textContent(), "the picked emoji lands in the composer")
			.not.toBe("hello world");

		const finalText = (await typebox.textContent()) ?? "";
		expect(finalText.startsWith("hello "), `[${kind}] emoji sits after "hello "`).toBe(true);
		expect(finalText.endsWith("world"), `[${kind}] "world" follows the emoji`).toBe(true);
	});
}

// The tests above click into the box first, so they start with a caret in it. These two do
// not: the button must still open the picker and must not insert ahead of the draft.
test("emoji button opens the picker on a fresh boot, before the box is touched", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	await page.locator("#emojiTB").click();

	await expect(page.locator(".emojiPicker")).toBeVisible();
});

test("with text selected in a message, a picked emoji goes after the draft", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.type("hello");
	await page
		.locator(".messagediv", {hasText: "Welcome to the mock guild!"})
		.getByText("Welcome to the mock guild!")
		.click({clickCount: 3});

	await page.locator("#emojiTB").click();
	await page.locator(".emojiPicker .emojiBody .emojiSelect").first().click();
	await expect.poll(() => typebox.textContent(), "the picked emoji lands").not.toBe("hello");

	expect(((await typebox.textContent()) ?? "").startsWith("hello")).toBe(true);
});
