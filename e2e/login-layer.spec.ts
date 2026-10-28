import {expect} from "@playwright/test";
import {MOCK_INSTANCE_ORIGIN, test} from "./fixtures";

// T1 of the verification-tooling theme: the login-layer regressions. The refusal pin is
// walk item 1b; the rewrite-dialog pin is the e7f6b657 class - a Dialog that opened UNDER
// the raised login layer was invisible yet blocked the flow, which the unit tier's
// z-index arithmetic cannot fully see (no real CSS there).

/** Drives the shared path to the login form: pick the mock instance, switch to Login,
 * wait for the instance check to enable the submit. Returns the form-scoped locators. */
async function openLoginForm(page: import("@playwright/test").Page) {
	await page.getByRole("heading", {name: "Mock Instance", exact: true}).click();
	await page.getByText("Already have an account?", {exact: true}).click();
	const loginForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});
	await expect(loginForm.getByRole("button", {name: "Login", exact: true})).toBeEnabled();
	return loginForm;
}

test("a refused login shows the field refusal and stays on the form", async ({
	page,
	mockInstance,
}) => {
	mockInstance.onLogin = (route) =>
		route.fulfill({
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({message: "Incorrect credentials"}),
		});

	await page.goto("/");
	const loginForm = await openLoginForm(page);
	await loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("testuser@example.test");
	await loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("wrong-password");
	await loginForm.getByRole("button", {name: "Login", exact: true}).click();

	// The server refusal lands as a .suberror under the password field (Form makeError);
	// the form stays up and no session starts. A SUCCESSFUL login would navigate and
	// re-boot the SPA, re-fetching instances.json - so exactly one fetch pins "stayed".
	await expect(loginForm.locator(".suberror", {hasText: "Incorrect credentials"})).toBeVisible();
	await expect(loginForm.getByRole("button", {name: "Login", exact: true})).toBeVisible();
	expect(
		mockInstance.capturedRequests.filter((req) => req.pathname === "/instances.json"),
	).toHaveLength(1);
});

// The refusal Spacebar actually sends for a bad login: a 400 FieldError with the message
// under both fields (machloket-server src/api/routes/auth/login.ts, util/FieldError.ts) -
// the case above pins only the top-level-message fallback.
test("Spacebar's own field refusal shows under the form and keeps it up", async ({
	page,
	mockInstance,
}) => {
	const refusal = {code: "INVALID_LOGIN", message: "Invalid login or password."};
	mockInstance.onLogin = (route) =>
		route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({
				code: 50035,
				message: "Invalid Form Body",
				errors: {login: {_errors: [refusal]}, password: {_errors: [refusal]}},
			}),
		});

	await page.goto("/");
	const loginForm = await openLoginForm(page);
	await loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("testuser@example.test");
	await loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("wrong-password");
	await loginForm.getByRole("button", {name: "Login", exact: true}).click();

	// Form's field-error path places it under the field the server named first (login,
	// the email input) - not the onErrorBody fallback the case above pins.
	const emailField = loginForm.locator(".optionElement", {
		has: page.getByText("Email:", {exact: true}),
	});
	await expect(emailField.locator(".suberror", {hasText: "Invalid login or password."})).toBeVisible();
	await expect(loginForm.getByRole("button", {name: "Login", exact: true})).toBeVisible();
	expect(
		mockInstance.capturedRequests.filter((req) => req.pathname === "/instances.json"),
	).toHaveLength(1);
});

test("the instance-rewrite dialog renders above the raised auth dialog", async ({page}) => {
	// A remote-named entry whose well-known advertises a loopback API: the loopback
	// mismatch is exactly what triggers checkURLs' rewrite prompt. The flow runs through
	// the register dialog (the picker card's path); the pin holds for the login dialog
	// too - both auth dialogs raise to z-index 200 and the fix (goAbove) is shared.
	// Spec-level routes register after the fixture's, so they win for these URLs.
	await page.route("http://mock-remote.example/.well-known/spacebar/client", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				api: {baseUrl: "http://127.0.0.1:4173"},
				gateway: {baseUrl: "ws://127.0.0.1:4173"},
				cdn: {baseUrl: "http://127.0.0.1:4173"},
			}),
		}),
	);
	await page.route(`${MOCK_INSTANCE_ORIGIN}/instances.json`, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify([
				{
					name: "Remote Mock",
					description: "Loopback-mismatch fixture for the rewrite dialog",
					url: "http://mock-remote.example",
				},
			]),
		}),
	);
	// Declining asks the ADVERTISED api for a ping to double-check the rewrite; it lives
	// on 127.0.0.1, which neither the mock's origin-locked predicate nor the off-origin
	// net touches. Answer it here so the flow stays hermetic (a 404 sends checkURLs down
	// the same decline branch the CORS rejection would).
	await page.route("http://127.0.0.1:4173/api/v9/ping", (route) =>
		route.fulfill({status: 404, body: ""}),
	);
	// The picker also asks the advertised api for its policies config (the signup DOB
	// gate); a 404 here sends that fetch down its show-field fallback, which is what
	// this scenario wants to see anyway.
	await page.route("http://127.0.0.1:4173/api/v9/policies/instance/config", (route) =>
		route.fulfill({status: 404, body: ""}),
	);

	await page.goto("/");
	await page.getByRole("heading", {name: "Remote Mock", exact: true}).click();

	// The rewrite prompt must be VISIBLE with real CSS (the shipped bug: it opened
	// underneath the raised layer, invisible and unclickable), and the element actually
	// painted at its center must be the dialog itself - DOM presence alone can hide
	// under a later sibling at equal z-index.
	const dialogText = page.getByText("This instance has likely sent the incorrect links.", {
		exact: false,
	});
	await expect(dialogText).toBeVisible();
	// Identity, not text: the layer's .background holds the prompt's text too, so a
	// textContent match passes over a covered prompt. Polled with the center re-measured
	// each tick: the dialog animates in, and a box read mid-entry points off the prompt.
	// The painted hit is checked against the prompt's own .dialogModal, not the text
	// element's subtree: getByText resolves the markdown text's inline span, and a
	// multi-line span only hit-tests on its per-line boxes — its bounding-rect center can
	// land in the inter-line gap, where the block parent (the prompt's own markdown h2)
	// is the painted element - an ancestor hit reads as a covered prompt but isn't one. A
	// covered by the raised auth layer would still fail: its hit lands in the OTHER
	// dialog's .dialogModal.
	await expect
		.poll(
			() =>
				dialogText.evaluate((el) => {
					const dialog = el.closest(".dialogModal");
					if (!dialog) return "no-dialog";
					const r = el.getBoundingClientRect();
					const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
					if (!hit) return "nothing";
					return dialog.contains(hit) ? "prompt" : `${hit.tagName}.${String(hit.className)}`;
				}),
			"the prompt's own dialog is what's painted at its text's center",
		)
		.toBe("prompt");

	// Declining closes the prompt; checkURLs then settles null and the picker keeps the
	// advertised URLs unchanged.
	await page.getByRole("button", {name: "No", exact: true}).click();
	await expect(dialogText).toBeHidden();
});

test("the auth layer's instance picker renders input, suggestions and verdict", async ({
	page,
	mockInstance,
}) => {
	await page.goto("/");
	await page.getByRole("heading", {name: "Mock Instance", exact: true}).click();

	// The picker is a search input bound to a shared datalist (the native dropdown) with
	// a suggest box and a verify line that reads the live check state.
	const instanceInput = page.locator("input[list=instances]");
	await expect(instanceInput).toBeVisible();
	await expect(page.locator("#instances option").first()).toBeAttached();
	await expect(page.locator(".instancesuggest")).toBeAttached();

	// The mock instance validated: the verdict reads All good until the 3s clear timer,
	// and the check really went through the mock's well-known.
	await expect(page.getByText("All good", {exact: true})).toBeVisible();
	expect(
		mockInstance.capturedRequests.some((req) => req.pathname === "/.well-known/spacebar/client"),
	).toBe(true);
});
