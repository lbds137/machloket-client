import {expect, type Page} from "@playwright/test";
import {
	drain,
	loginAndOpenChannel,
	MOCK_INSTANCE_NAME,
	MOCK_INSTANCE_ORIGIN,
	test,
} from "./fixtures";

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

test("booting a stored account from a hand-off that also carries a session-only one shows no session-only Dialog", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	const HANDOFF_KEY = "machloket.sessionAccounts";
	await loginAndOpenChannel(page);
	await drain(page);
	await expect(page.locator(".dialogModal")).toHaveCount(0);

	// What a navigation leaves when the store refused a second, session-only account: the
	// hand-off lists both, and the account that boots is the stored one.
	await page.evaluate((key) => {
		const info = JSON.parse(localStorage.getItem("userinfos")!);
		const stored = info.users[info.currentuser];
		info.users["sessiononly@example.test" + stored.serverurls.wellknown] = {
			...stored,
			email: "sessiononly@example.test",
		};
		sessionStorage.setItem(key, JSON.stringify(info));
	}, HANDOFF_KEY);

	await page.goto("/channels/@me");
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
	expect(await page.evaluate((key) => sessionStorage.getItem(key), HANDOFF_KEY)).toBeNull();
	await drain(page);
	await expect(page.locator(".dialogModal")).toHaveCount(0);
});

// A session-only account rides a hand-off to a page that doesn't boot the app (the login page,
// after the switcher's add-account): the hand-off is what lands there, before any reload.
async function landOnLoginWithHandoff(page: Page): Promise<void> {
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
		([key, origin]) => {
			// Only the first load gets the hand-off, as the navigation that carried it would leave it.
			if (sessionStorage.getItem("e2e.seeded")) return;
			sessionStorage.setItem("e2e.seeded", "1");
			const id = "sessiononly@example.test" + origin;
			// A whole account, as the app writes one: the login page's account list drops an
			// entry it can't build.
			const account = {
				email: "sessiononly@example.test",
				token: "tok",
				serverurls: {
					api: origin + "/api/v9",
					cdn: origin,
					gateway: "ws://localhost:4173",
					wellknown: origin,
				},
			};
			sessionStorage.setItem(key, JSON.stringify({users: {[id]: account}, currentuser: id}));
		},
		[HANDOFF_KEY, MOCK_INSTANCE_ORIGIN],
	);
	await page.goto("/login.html");
	await expect(loginForm(page)).toBeVisible();
}

const HANDOFF_KEY = "machloket.sessionAccounts";
const readHandoff = (page: Page) =>
	page.evaluate((key) => sessionStorage.getItem(key), HANDOFF_KEY);
const navigationType = (page: Page) =>
	page.evaluate(
		() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type,
	);
const loginForm = (page: Page) =>
	page.locator(".FormSettings", {has: page.getByRole("button", {name: "Login", exact: true})});

test("a reload of the login page drops a session-only account the hand-off carried there", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await landOnLoginWithHandoff(page);
	// Landing keeps it: the next in-app navigation still has it to carry.
	expect(await readHandoff(page)).not.toBeNull();

	await page.reload();
	await expect(loginForm(page)).toBeVisible();
	expect(await navigationType(page)).toBe("reload");
	expect(await readHandoff(page)).toBeNull();
});

test("an in-app navigation to the page already open keeps the hand-off: it is not a reload", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await landOnLoginWithHandoff(page);

	// Marks this document: the check after the navigation proves a new one loaded, since the
	// first page's own entry also reads "navigate".
	await page.evaluate(() => {
		(window as {e2eFirstDocument?: boolean}).e2eFirstDocument = true;
	});
	// The shape of pageNav.go to the current URL (the switcher's logout lands where it already is).
	await Promise.all([
		page.waitForEvent("framenavigated"),
		page.evaluate(() => {
			window.location.href = window.location.href;
		}),
	]);
	await expect(loginForm(page)).toBeVisible();
	expect(
		await page.evaluate(() => (window as {e2eFirstDocument?: boolean}).e2eFirstDocument),
	).toBeUndefined();
	expect(await navigationType(page)).toBe("navigate");
	expect(await readHandoff(page)).toContain("sessiononly@example.test");
});
