import {expect, type Page} from "@playwright/test";
import {test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});

/** Boots /register.html and waits for the default mock instance check and config fetch to settle. */
async function openRegisterForm(page: Page) {
	await page.goto("/register.html");
	const registerForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Create account", exact: true}),
	});
	await expect(
		registerForm.getByRole("button", {name: "Create account", exact: true}),
	).toBeEnabled();
	return registerForm;
}

async function fillCommonFields(page: Page, registerForm: ReturnType<Page["locator"]>) {
	await registerForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("newuser@example.test");
	await registerForm
		.locator(".optionElement", {has: page.getByText("Username:", {exact: true})})
		.locator("input")
		.fill("newuser");
	await registerForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("e2e-mock-password");
	await registerForm
		.locator(".optionElement", {has: page.getByText("Enter password again:", {exact: true})})
		.locator("input")
		.fill("e2e-mock-password");
	await registerForm.locator('input[type="checkbox"]').check();
}

test("default config keeps the DOB field, posts date_of_birth, and renders a server field error on it", async ({
	page,
	mockInstance,
}) => {
	const bodies: unknown[] = [];
	await page.route("**/api/v9/auth/register", async (route) => {
		bodies.push(route.request().postDataJSON());
		await route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({
				code: 50035,
				message: "Invalid Form Body",
				errors: {
					date_of_birth: {
						_errors: [
							{
								code: "DATE_OF_BIRTH_UNDERAGE",
								message: "You must be at least 13 years old",
							},
						],
					},
				},
			}),
		});
	});

	const registerForm = await openRegisterForm(page);
	await expect
		.poll(() =>
			mockInstance.capturedRequests.some(
				(req) => req.pathname === "/api/v9/policies/instance/config",
			),
		)
		.toBe(true);

	const dobField = registerForm.locator(".optionElement", {
		has: page.getByText("Date of birth:", {exact: true}),
	});
	const dobInput = dobField.locator('input[type="date"]');
	await expect(dobInput).toBeVisible();

	await fillCommonFields(page, registerForm);
	await dobInput.fill("2015-01-01");
	await registerForm.getByRole("button", {name: "Create account", exact: true}).click();

	await expect.poll(() => bodies.length).toBe(1);
	expect(bodies[0]).toMatchObject({date_of_birth: "2015-01-01"});
	await expect(
		dobField.locator(".suberror", {hasText: "You must be at least 13 years old"}),
	).toBeVisible();
});

test.describe("when register_dateOfBirth_required is false", () => {
	test.use({mockInstanceOptions: {policiesConfig: {register_dateOfBirth_required: false}}});

	test("hides the DOB field and drops date_of_birth from the register payload", async ({
		page,
		mockInstance,
	}) => {
		void mockInstance;
		const bodies: unknown[] = [];
		await page.route("**/api/v9/auth/register", async (route) => {
			bodies.push(route.request().postDataJSON());
			await route.fulfill({status: 204, body: ""});
		});

		const registerForm = await openRegisterForm(page);
		const dobInput = registerForm.locator('input[type="date"]');
		await expect(dobInput).toBeHidden();

		await fillCommonFields(page, registerForm);
		await registerForm.getByRole("button", {name: "Create account", exact: true}).click();

		await expect.poll(() => bodies.length).toBe(1);
		expect(Object.keys(bodies[0] as object)).not.toContain("date_of_birth");
	});
});
