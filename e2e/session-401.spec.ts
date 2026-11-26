import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// A dead session found mid-use routes to /login (apiFetch.handleUnauthorized). The 401 path
// engages only for a request whose headers the account builder tagged (TASK-148), so this
// runs through the real Localuser.headers: the send XHR's 401, then the /users/@me probe.
test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

const identifies = (mock: {gatewayFrames: {fromApp: unknown[]}}) =>
	mock.gatewayFrames.fromApp.filter((f) => (f as {op?: number}).op === 2).length;

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
	const before = identifies(mockInstance);

	await page.reload();

	await expect(page).toHaveURL(/\/login/);
	expect(probes).toEqual([`GET ${mockInstance.api}/users/@me ${mockInstance.token}`]);
	// A dead session is routed out, never retried.
	expect(identifies(mockInstance) - before).toBe(1);
});

// A 4004 whose probe does not find the session dead - it answers alive (REST accepts the token
// the gateway refused: a server bug or a token-rotation race) or gives no verdict (5xx, 429, no
// answer) - retries IDENTIFY once on its own; a second 4004 shows a Retry button on the loading
// screen instead of a dead end, and a Retry never re-arms the automatic one (TASK-157). The
// Retry state's line names what the probe found (TASK-172).
for (const [name, probeAnswer, retryLine] of [
	[
		"finds the session alive",
		{status: 200, json: {id: "1", username: "alive"}},
		"The instance refused the connection, but your session is still valid. Retry, or switch accounts if it keeps happening.",
	],
	[
		"gets no verdict",
		{status: 503, json: {message: "Service unavailable", code: 0}},
		"The instance refused the connection and didn't answer a session check. Retry, or switch accounts if it keeps happening.",
	],
] as const) {
	test(`a gateway closing 4004 while the probe ${name} retries once, then offers Retry`, async ({
		page,
		mockInstance,
	}) => {
		await loginAndOpenChannel(page);
		const retry = page.locator("#gatewayRetry");
		await expect(retry).toBeHidden();
		let probes = 0;
		await page.route("**/api/v9/users/@me", async (route) => {
			probes++;
			await route.fulfill(probeAnswer);
		});
		mockInstance.identifyCloses = 4004;
		const before = identifies(mockInstance);

		await page.reload();

		await expect(retry).toBeVisible();
		// One automatic retry: two IDENTIFYs, each refused and probed, and no third on its own.
		expect(identifies(mockInstance) - before).toBe(2);
		expect(probes).toBe(2);
		await expect(page.locator("#load-desc")).toHaveText(retryLine);
		// The offer announces itself: focus lands on the button, and the line above it is a
		// polite live region (TASK-174).
		await expect(retry).toBeFocused();
		await expect(page.locator("#load-desc")).toHaveAttribute("role", "status");
		// No verdict of death: the account stays stored as logged in, and no /login.
		await expect
			.poll(() =>
				page.evaluate(() => {
					const users = JSON.parse(localStorage.getItem("userinfos") ?? "{}").users ?? {};
					return Object.values(users).map((u) => (u as {loggedin?: boolean}).loggedin);
				}),
			)
			.toEqual([true]);
		expect(page.url()).not.toMatch(/\/login/);

		// A Retry while the gateway still refuses: one IDENTIFY, then the button again.
		await retry.click();
		await expect.poll(() => probes).toBe(3);
		await expect(retry).toBeVisible();
		expect(identifies(mockInstance) - before).toBe(3);

		// The gateway accepts the session again: Retry connects and the app loads.
		await page.unroute("**/api/v9/users/@me");
		mockInstance.identifyCloses = undefined;
		await retry.click();
		await expect(page.locator("#loading")).toHaveClass(/doneloading/);
		await expect(retry).toBeHidden();
		expect(identifies(mockInstance) - before).toBe(4);
		expect(probes).toBe(3);
	});
}

// A server that answers IDENTIFY with READY, then closes 4004 while REST finds the session alive,
// must not loop: READY alone does not re-arm the automatic retry, so the second refusal offers
// Retry instead of a third IDENTIFY (TASK-173).
test("a gateway that sends READY then closes 4004 retries once, then offers Retry", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	const retry = page.locator("#gatewayRetry");
	let probes = 0;
	await page.route("**/api/v9/users/@me", async (route) => {
		probes++;
		await route.fulfill({status: 200, json: {id: "1", username: "alive"}});
	});
	mockInstance.readyThenCloses = 4004;
	const before = identifies(mockInstance);

	await page.reload();

	await expect(retry).toBeVisible();
	// The line the offer set stands once the retried socket's init settles: "Loaded" must not
	// clobber the Retry state's line while the button is still up (TASK-172).
	await expect(page.locator("#load-desc")).toHaveText(
		"The instance refused the connection, but your session is still valid. Retry, or switch accounts if it keeps happening.",
	);
	expect(identifies(mockInstance) - before).toBe(2);
	expect(probes).toBe(2);
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
