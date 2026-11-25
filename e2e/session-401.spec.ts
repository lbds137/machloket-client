import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// A dead session found mid-use routes to /login (apiFetch.handleUnauthorized). The 401 path
// engages only for a request whose headers the account builder tagged (TASK-148), so this
// runs through the real Localuser.headers: the send XHR's 401, then the /users/@me probe.
test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

// Gateway close 4004 is the server's "authentication failed": a token that died while the app
// was closed meets it at the next IDENTIFY. It takes the same verified path (TASK-147).
test("a gateway closing 4004 on a dead session routes to /login", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	const probes: string[] = [];
	await page.route("**/api/v9/users/@me", async (route) => {
		const req = route.request();
		probes.push(`${req.method()} ${req.url()} ${await req.headerValue("authorization")}`);
		await route.fulfill({status: 401, json: {message: "401: Unauthorized", code: 0}});
	});
	mockInstance.identifyCloses = 4004;

	await page.reload();

	await expect(page).toHaveURL(/\/login/);
	expect(probes).toEqual([`GET ${mockInstance.api}/users/@me ${mockInstance.token}`]);
});

test("a gateway closing 4004 while the probe finds the session alive logs no one out", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	let probes = 0;
	await page.route("**/api/v9/users/@me", async (route) => {
		probes++;
		await route.fulfill({status: 200, json: {id: "1", username: "alive"}});
	});
	mockInstance.identifyCloses = 4004;

	const probed = page.waitForResponse("**/api/v9/users/@me");
	await page.reload();
	await probed;

	await expect(page.locator("#load-desc")).toHaveText(/Unable to connect/);
	// The probe's answer is in: a live session stays stored as logged in, and no /login.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const users = JSON.parse(localStorage.getItem("userinfos") ?? "{}").users ?? {};
				return Object.values(users).map((u) => (u as {loggedin?: boolean}).loggedin);
			}),
		)
		.toEqual([true]);
	expect(probes).toBe(1);
	expect(page.url()).not.toMatch(/\/login/);
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
