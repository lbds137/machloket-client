import {expect, type Page} from "@playwright/test";
import {test} from "./fixtures";
import {MOCK_LOGIN_RESPONSE, type MockInstanceHandle} from "./mock/index";

// TASK-149: an instance whose discovery offers cookie sessions gets a cookie login. The
// session never reaches page script: no token in the login answer, the stored account, the
// REST headers or the gateway's IDENTIFY. The unit tier pins each step; this runs them in
// order on a real page boot.

async function logIn(page: Page) {
	await page.goto("/");
	await page.getByRole("heading", {name: "Mock Instance", exact: true}).click();
	await page.getByText("Already have an account?", {exact: true}).click();
	const loginForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});
	const submit = loginForm.getByRole("button", {name: "Login", exact: true});
	await expect(submit).toBeEnabled();
	await loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("testuser@example.test");
	await loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("a-password");
	await submit.click();
}

/** The account's REST requests from capture index `from` on: not auth, and not the instance's
 * public reads (ping, its config), which go out with no account. */
function accountCalls(mockInstance: MockInstanceHandle, from: number) {
	return mockInstance.capturedRequests
		.slice(from)
		.filter(
			(r) =>
				r.pathname.startsWith("/api/v9/") &&
				!r.pathname.startsWith("/api/v9/auth/") &&
				r.pathname !== "/api/v9/ping" &&
				!r.pathname.startsWith("/api/v9/policies/instance/"),
		);
}

test.describe("cookie-session instance", () => {
	test.use({mockInstanceOptions: {authCookie: true}});

	test("logs in by cookie and connects with no token anywhere in page script", async ({
		page,
		mockInstance,
	}) => {
		const loginHeaders: Record<string, string>[] = [];
		let capturedAtLogin = Infinity;
		mockInstance.onLogin = (route) => {
			loginHeaders.push(route.request().headers());
			capturedAtLogin = mockInstance.capturedRequests.length;
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({auth_mode: "cookie"}),
			});
		};

		await logIn(page);

		await expect
			.poll(() => mockInstance.gatewayFrames.fromApp.some((f) => (f as {op?: number}).op === 2))
			.toBe(true);
		expect(loginHeaders).toHaveLength(1);
		expect(loginHeaders[0]["x-machloket-auth"]).toBe("cookie");
		expect(loginHeaders[0]["x-machloket-csrf"]).toBe("1");

		const identify = mockInstance.gatewayFrames.fromApp.find(
			(f) => (f as {op?: number}).op === 2,
		) as {d: Record<string, unknown>};
		expect(identify.d).not.toHaveProperty("token");

		const stored = await page.evaluate(() => localStorage.getItem("userinfos"));
		const users = Object.values(JSON.parse(stored!).users) as Record<string, unknown>[];
		expect(users).toHaveLength(1);
		expect(users[0].auth_mode).toBe("cookie");
		expect(users[0]).not.toHaveProperty("token");

		const restCalls = (from = 0) =>
			mockInstance.capturedRequests
				.slice(from)
				.filter(
					(r) => r.pathname.startsWith("/api/v9/") && !r.pathname.startsWith("/api/v9/auth/"),
				);
		// Non-empty first: the checks below would pass on no requests at all.
		await expect.poll(() => accountCalls(mockInstance, capturedAtLogin).length).toBeGreaterThan(0);
		// After the poll, so the account's own REST is among what it checks.
		expect(restCalls().filter((r) => r.authorization !== undefined)).toEqual([]);
		// The cookie account's REST goes out marked: the wrapper sends credentials only then.
		expect(accountCalls(mockInstance, capturedAtLogin).filter((r) => r.csrf !== "1")).toEqual([]);
	});
});

test("a stock instance logs in by token, with no cookie opt-in", async ({page, mockInstance}) => {
	const loginHeaders: Record<string, string>[] = [];
	let capturedAtLogin = Infinity;
	mockInstance.onLogin = (route) => {
		loginHeaders.push(route.request().headers());
		capturedAtLogin = mockInstance.capturedRequests.length;
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(MOCK_LOGIN_RESPONSE),
		});
	};

	await logIn(page);

	await expect
		.poll(() => mockInstance.gatewayFrames.fromApp.some((f) => (f as {op?: number}).op === 2))
		.toBe(true);
	expect(loginHeaders).toHaveLength(1);
	expect(loginHeaders[0]).not.toHaveProperty("x-machloket-auth");
	// Non-empty first, and the account's own REST: the public reads carry no marker either way.
	await expect.poll(() => accountCalls(mockInstance, capturedAtLogin).length).toBeGreaterThan(0);
	// A header account's REST carries no cookie marker.
	expect(accountCalls(mockInstance, capturedAtLogin).filter((r) => r.csrf !== undefined)).toEqual(
		[],
	);
});
