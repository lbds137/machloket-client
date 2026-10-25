import {expect, type Page} from "@playwright/test";
import {
	type MockInstanceHandle,
	MOCK_FORM_MODAL,
	MOCK_BUTTON_MESSAGE_ID,
	loginAndOpenChannel,
	openModalViaButton,
	test,
} from "./fixtures";

// T3 phone-layout, first half: a bot's form (INTERACTION_MODAL_CREATE) is one sheet the
// size of the space above the keyboard, Submit in reach — the M1 pin (c17e001a), extended
// from modalPhone.test.ts into the built app with real CSS and the REAL entry path
// (button tap -> POST /api/v9/interactions -> gateway frame). The keyboard is simulated
// by shrinking the viewport to the band the keyboard would leave: the sheet CSS keys on
// the layout viewport (height: 100%; the app.html meta sets interactive-widget=
// resizes-content), which is exactly what setViewportSize drives.

const DIALOG = ".dialogModal";

/** Opens the tall form through the real path and leaves it on screen. */
async function openForm(page: Page, mockInstance: MockInstanceHandle): Promise<void> {
	await openModalViaButton(page, mockInstance, MOCK_FORM_MODAL);
}

test("a bot's form is one sheet the size of the phone viewport", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	await expect(page.locator("#scrollWrap"), "the button message rendered").toContainText(
		"Need some details:",
	);
	await openForm(page, mockInstance);

	// The sheet IS the viewport: top-left corner, full width, full height (the profile's
	// real page viewport — read live; the descriptor's screen size is not the viewport).
	// Polled because the sheet's entry motion settles into this geometry. The form's own
	// inner padding is the modal's styling, not the M1 layout pin, and stays unpinned.
	const viewport = page.viewportSize()!;
	await expect
		.poll(async () => {
			const box = await page.locator(DIALOG).boundingBox();
			return box
				? {
						top: Math.round(box.y),
						left: Math.round(box.x),
						w: Math.round(box.width),
						h: Math.round(box.height),
					}
				: {};
		}, "the sheet settles as one full-viewport layer")
		.toEqual({top: 0, left: 0, w: viewport.width, h: viewport.height});
});

test("with the keyboard up, the sheet fills the band above it and Submit stays in reach", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await openForm(page, mockInstance);

	// The keyboard: the viewport shrinks to the space above it.
	await page.setViewportSize({width: page.viewportSize()!.width, height: 420});

	const dialog = page.locator(DIALOG);
	await expect
		.poll(async () => {
			const box = await dialog.boundingBox();
			return box ? Math.round(box.height) : 0;
		}, "the sheet must follow the layout viewport, not a height snapshot")
		.toBe(420);

	// Submit stays on the shrunken screen.
	const submit = await page.locator(".interactionModalSubmit").boundingBox();
	expect(submit, "Submit rendered").not.toBeNull();
	expect(submit!.y).toBeGreaterThanOrEqual(0);
	expect(submit!.y + submit!.height).toBeLessThanOrEqual(420);

	// One scrolling frame: the fields scroll, the sheet and its backdrop do not.
	const scroll = await page
		.locator(".interactionModal")
		.evaluate((root: HTMLElement) => {
			const body = root.querySelector<HTMLElement>(".interactionModalBody")!;
			const frame = root.closest<HTMLElement>(".dialogModal")!;
			return {
				body: body.scrollHeight > body.clientHeight,
				frame: frame.scrollHeight > frame.clientHeight,
				root: root.scrollHeight > root.clientHeight,
			};
		});
	expect(scroll).toEqual({body: true, frame: false, root: false});

	// The keyboard-band look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(dialog).toHaveScreenshot("form-sheet-keyboard.png");
});

test("the form modal names the opener message in its submit", async ({page, mockInstance}) => {
	// The modal's submit carries the opener's message id (localuser passes openerMessageId);
	// a form opened from a button must submit against that message, not bare.
	await loginAndOpenChannel(page);
	await expect(page.locator("#scrollWrap")).toContainText("Need some details:");
	await openForm(page, mockInstance);

	await page.locator(".interactionModalBody textarea, .interactionModalBody input:not([type=checkbox])")
		.first()
		.fill("hello from the e2e");
	await page.locator(".interactionModalSubmit").tap();

	// The modal's accepted submit closes the Dialog: the shell leaves the DOM
	// asynchronously, once removeAni's fade finishes (modal.ts close() -> utils
	// removeAni) — unlike the select sheet's synchronous backdrop.remove().
	// toBeHidden passes both before and after the element detaches.
	await expect(page.locator(DIALOG)).toBeHidden();
	const submits = mockInstance.capturedRequests.filter(
		(req) => req.method === "POST" && req.pathname === "/api/v9/interactions",
	);
	expect(submits.length).toBe(2);
	const submitBody = submits[1].body as {
		type: number;
		message_id?: string;
		data: {custom_id: string};
	};
	expect(submitBody.type).toBe(5);
	expect(submitBody.message_id).toBe(MOCK_BUTTON_MESSAGE_ID);
	expect(submitBody.data.custom_id).toBe("e2e-form");
});
