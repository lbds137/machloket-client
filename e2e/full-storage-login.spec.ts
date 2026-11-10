import {expect} from "@playwright/test";
import {drain, MOCK_INSTANCE_NAME, MOCK_INSTANCE_ORIGIN, test} from "./fixtures";

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

test("a session-only account the app can't start is used up without its Dialog, so a reload signs out", async ({
	page,
	mockInstance,
}) => {
	// After the reload the app shows the login screen, which looks up the default instance.
	void mockInstance;
	const HANDOFF_KEY = "machloket.sessionAccounts";
	const email = "broken@example.test";
	// Stored accounts are keyed by email + wellknown (Specialuser.uid).
	const uid = email + MOCK_INSTANCE_ORIGIN;
	// A session-only account exists only because localStorage is full.
	await page.addInitScript(() => {
		const realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (this === window.localStorage) {
				throw new DOMException(`Quota exceeded writing ${key}`, "QuotaExceededError");
			}
			return realSetItem.call(this, key, value);
		};
	});
	await page.addInitScript(
		([key, id, mail, origin]) => {
			// Only the first load gets the hand-off, as the login page's redirect would leave it.
			if (sessionStorage.getItem("e2e.seeded")) return;
			sessionStorage.setItem("e2e.seeded", "1");
			sessionStorage.setItem("currentuser", id);
			sessionStorage.setItem(
				key,
				JSON.stringify({
					users: {
						[id]: {
							email: mail,
							token: "tok",
							serverurls: {
								api: origin + "/api/v9",
								cdn: origin,
								gateway: "ws://localhost:4173",
								wellknown: origin,
							},
							// The account passes the stored-list checks, but its stored user settings
							// aren't an object: the app's account constructor throws on them.
							localuserStore: {user: 5},
						},
					},
					currentuser: id,
				}),
			);
		},
		[HANDOFF_KEY, uid, email, MOCK_INSTANCE_ORIGIN],
	);

	await page.goto("/channels/@me");
	await expect(page.locator("#load-desc")).toHaveText("Account unable to start");
	expect(await page.evaluate((key) => sessionStorage.getItem(key), HANDOFF_KEY)).toBeNull();
	// The account never started, so "signed in for this session only" would be untrue.
	await drain(page);
	await expect(page.locator(".dialogModal")).toHaveCount(0);

	await page.reload();
	await expect(
		page.locator(".FormSettings", {
			has: page.getByRole("button", {name: "Login", exact: true}),
		}),
	).toBeVisible();
});
