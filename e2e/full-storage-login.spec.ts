import {expect} from "@playwright/test";
import {drain, MOCK_INSTANCE_NAME, test} from "./fixtures";

const ACCOUNT_NOT_SAVED_COPY =
	"Signed in for this session only: this browser's storage for Machloket is full, so you'll need to sign in again after a reload.";

test("signing in with localStorage full boots for the session with one dialog, and asks to sign in again after a reload", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const uncaught: string[] = [];
	page.on("pageerror", (error) => uncaught.push(String(error.stack ?? error)));

	await page.addInitScript(() => {
		const realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (this === window.localStorage) {
				throw new DOMException(`Quota exceeded writing ${key}`, "QuotaExceededError");
			}
			return realSetItem.call(this, key, value);
		};
	});

	await page.goto("/");

	const instanceHeading = page.getByRole("heading", {name: MOCK_INSTANCE_NAME, exact: true});
	await expect(instanceHeading).toBeVisible();
	await instanceHeading.click();

	await page.getByText("Already have an account?", {exact: true}).click();

	const loginForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});
	const loginSubmit = loginForm.getByRole("button", {name: "Login", exact: true});
	await expect(loginSubmit).toBeEnabled();

	await loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("testuser@example.test");
	await loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("e2e-mock-password");
	await loginSubmit.click();

	await expect(page).toHaveURL(/\/channels\/@me$/);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});

	const guildIcon = page.locator("#servers img.servericon").filter({visible: true}).first();
	await expect(guildIcon).toBeVisible();

	await drain(page);
	const dialog = page.locator(".dialogModal");
	await expect(dialog).toHaveCount(1);
	await expect(dialog).toHaveText(ACCOUNT_NOT_SAVED_COPY);

	await page.reload();
	await expect(
		page.locator(".FormSettings", {
			has: page.getByRole("button", {name: "Login", exact: true}),
		}),
	).toBeVisible();
	expect(uncaught).toEqual([]);
});
