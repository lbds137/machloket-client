import {expect} from "@playwright/test";
import {MOCK_REQUIRED_MODAL, loginAndOpenChannel, openModalViaButton, test} from "./fixtures";

// The server-refusal half of modal validation: when POST /api/v9/interactions returns non-ok,
// modal.ts submit() walks errorPaths(body.errors) and maps each field's first _errors message
// onto its .interactionModalError via fieldsAt (keyed by top-level component index), leaving
// the dialog open so the user can retry.

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

// Nested object shape (errorPaths builds dotted paths while descending): top-level component 0
// in MOCK_REQUIRED_MODAL is the Label wrapping the "must" TextInput.
const SERVER_REFUSAL_BODY = {
	errors: {
		data: {
			components: {
				"0": {
					component: {
						value: {
							_errors: [{message: "Server says no"}],
						},
					},
				},
			},
		},
	},
};

test("a refused submit's server errors land under their fields and the modal stays open", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await openModalViaButton(page, mockInstance, MOCK_REQUIRED_MODAL);

	// Set after the opener so the button tap's own POST /api/v9/interactions takes the default 204.
	mockInstance.onInteractions = (route) =>
		route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify(SERVER_REFUSAL_BODY),
		});

	await page.locator('[data-custom-id="must"]').fill("needed");
	await page.locator('[data-custom-id="window"]').fill("valid");
	await page.locator(".interactionModalSubmit").tap();

	await expect(fieldError(page, "must")).toHaveText("Server says no");
	await expect(fieldError(page, "window")).toHaveText("");
	await expect(page.locator(DIALOG)).toBeVisible();
	expect(interactionPosts(mockInstance).length).toBe(2);
});

test("clearing the server refusal lets the resubmit through", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	await openModalViaButton(page, mockInstance, MOCK_REQUIRED_MODAL);

	mockInstance.onInteractions = (route) =>
		route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify(SERVER_REFUSAL_BODY),
		});

	await page.locator('[data-custom-id="must"]').fill("needed");
	await page.locator('[data-custom-id="window"]').fill("valid");
	await page.locator(".interactionModalSubmit").tap();

	await expect(fieldError(page, "must")).toHaveText("Server says no");
	await expect(fieldError(page, "window")).toHaveText("");
	await expect(page.locator(DIALOG)).toBeVisible();
	expect(interactionPosts(mockInstance).length).toBe(2);

	// submit() is not change-gated: resubmitting identical values re-sends once the refusal is
	// cleared, and the 204 closes the dialog.
	mockInstance.onInteractions = undefined;
	await page.locator(".interactionModalSubmit").tap();

	// The Dialog shell leaves the DOM asynchronously (removeAni's fade); toBeHidden
	// passes both before and after detach.
	await expect(page.locator(DIALOG)).toBeHidden();
	expect(interactionPosts(mockInstance).length).toBe(3);
});
