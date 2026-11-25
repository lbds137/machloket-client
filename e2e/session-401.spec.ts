import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// A dead session found mid-use routes to /login (apiFetch.handleUnauthorized). The 401 path
// engages only for a request whose headers the account builder tagged (TASK-148), so this
// runs through the real Localuser.headers: the send XHR's 401, then the /users/@me probe.
test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

test("a send refused because the session died routes to /login", async ({page}) => {
	await loginAndOpenChannel(page);
	const probes: (string | null)[] = [];
	await page.route("**/api/v9/channels/*/messages", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		await route.fulfill({status: 401, json: {message: "401: Unauthorized", code: 0}});
	});
	await page.route("**/api/v9/users/@me", async (route) => {
		probes.push(await route.request().headerValue("authorization"));
		await route.fulfill({status: 401, json: {message: "401: Unauthorized", code: 0}});
	});

	await page.locator("#typebox").click();
	await page.keyboard.type("sent on a dead session");
	await page.locator("#mobileSend").tap();

	await expect(page).toHaveURL(/\/login/);
	expect(probes.length).toBe(1);
	expect(probes[0]).toBeTruthy();
});
