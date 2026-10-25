import {expect} from "@playwright/test";
import {MOCK_REQUIRED_MODAL, loginAndOpenChannel, openModalViaButton, test} from "./fixtures";

// The validation half of the phone-form work: a bot's form checks its fields CLIENT-side
// at real CSS before anything is sent (modal.ts submit(): every field's problem() lands
// under it as .interactionModalError text, and any problem blocks the interaction POST).
// Required is the default (def.required !== false); optional fields stay quiet when empty
// but still enforce min_length/max_length once filled.

const DIALOG = ".dialogModal";
const INTERACTIONS = "/api/v9/interactions";

const fieldError = (page: import("@playwright/test").Page, customId: string) =>
	page.locator(`.interactionModalField:has([data-custom-id="${customId}"]) .interactionModalError`);

const interactionPosts = (mockInstance: {
	capturedRequests: {method: string; pathname: string; body: unknown}[];
}) =>
	mockInstance.capturedRequests.filter(
		(req) => req.method === "POST" && req.pathname === INTERACTIONS,
	);

test("an empty submit is blocked with per-field errors and nothing sent", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await openModalViaButton(page, mockInstance, MOCK_REQUIRED_MODAL);

	await page.locator(".interactionModalSubmit").tap();

	// The modal stays open; only the opener tap's POST exists — the blocked submit sent none.
	await expect(page.locator(DIALOG)).toBeVisible();
	expect(interactionPosts(mockInstance).length).toBe(1);

	// The required field trips; the optional one stays quiet when empty.
	await expect(fieldError(page, "must")).toHaveText("This field is required");
	await expect(fieldError(page, "window")).toHaveText("");

	// The required field's label carries the required marker; the optional one's does not.
	const requiredLabel = page.locator('.interactionModalField:has([data-custom-id="must"]) > label');
	await expect(requiredLabel).toHaveClass(/interactionModalRequired/);
	const optionalLabel = page.locator('.interactionModalField:has([data-custom-id="window"]) > label');
	await expect(optionalLabel).not.toHaveClass(/interactionModalRequired/);

	// The error state's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(page.locator(DIALOG)).toHaveScreenshot("modal-errors.png");
});

test("the length window rejects out-of-band values, then a valid submit sends", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await openModalViaButton(page, mockInstance, MOCK_REQUIRED_MODAL);

	const windowField = page.locator('[data-custom-id="window"]');
	const mustField = page.locator('[data-custom-id="must"]');

	// Under the minimum: blocked, with the window's own error.
	await windowField.fill("abc");
	await page.locator(".interactionModalSubmit").tap();
	await expect(fieldError(page, "window")).toHaveText("Must be between 5 and 10 characters");
	expect(interactionPosts(mockInstance).length).toBe(1);

	// Over the maximum: same error. maxLength caps typing at 10, so the value is set
	// programmatically to reach the branch at all. The untouched required field keeps
	// its own error alongside — two field errors at once.
	await windowField.evaluate((el: HTMLInputElement) => {
		el.value = "abcdefghijkl";
	});
	await page.locator(".interactionModalSubmit").tap();
	await expect(fieldError(page, "window")).toHaveText("Must be between 5 and 10 characters");
	await expect(fieldError(page, "must")).toHaveText("This field is required");
	expect(interactionPosts(mockInstance).length).toBe(1);

	// In band (plus the required answer): the submit goes out and the dialog closes.
	await mustField.fill("needed");
	await windowField.fill("valid");
	await page.locator(".interactionModalSubmit").tap();

	// The Dialog shell leaves the DOM asynchronously (removeAni's fade); toBeHidden
	// passes both before and after detach.
	await expect(page.locator(DIALOG)).toBeHidden();
	const posts = interactionPosts(mockInstance);
	expect(posts.length).toBe(2);
	const body = posts[1].body as {
		type: number;
		data: {
			custom_id: string;
			components: {type: number; component: {type: number; custom_id: string; value: string}}[];
		};
	};
	expect(body.type).toBe(5);
	expect(body.data.custom_id).toBe("e2e-validated-form");
	// The full Label-wrapped entries, ids omitted (no fixture id): the whole wire shape
	// the server contract reads.
	expect(body.data.components).toEqual([
		{type: 18, component: {type: 4, custom_id: "must", value: "needed"}},
		{type: 18, component: {type: 4, custom_id: "window", value: "valid"}},
	]);
});
