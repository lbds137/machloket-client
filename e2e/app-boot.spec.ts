import {expect} from "@playwright/test";
import {MOCK_CHANNEL, MOCK_GUILD, MOCK_INSTANCE_NAME, test} from "./fixtures";

test("picking the mock instance and logging in renders the fixture guild, channel, and messages", async ({
	page,
	mockInstance,
}) => {
	// Gateway handlers are async: a throw inside one never fails a step, it just leaves
	// the UI short. Carry page/console errors into the next assertion's failure message.
	// (A REST route.abort surfaces here only as a rejected fetch, not a console error -
	// the mock's own console.error names those in the runner output.)
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push("pageerror: " + String(error)));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push("console: " + message.text());
	});

	await page.goto("/");

	// 1. The mock instance appears in the home instance picker without editing public/instances.json.
	const instanceHeading = page.getByRole("heading", {name: MOCK_INSTANCE_NAME, exact: true});
	await expect(instanceHeading).toBeVisible();
	await instanceHeading.click();

	// 2. Clicking an instance card opens Register pre-filled with that instance; switch to Login.
	await page.getByText("Already have an account?", {exact: true}).click();

	// 3. Each addForm builds its own .FormSettings (register and login coexist in the DOM),
	// so scope every field to the form whose submit button says "Login".
	const loginForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});

	// Wait for InstancePicker.validate() to finish checking /.well-known/spacebar/client
	// and enable the Login submit button.
	const loginSubmit = loginForm.getByRole("button", {name: "Login", exact: true});
	await expect(loginSubmit).toBeEnabled();

	const emailInput = loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input");
	const passwordInput = loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input");

	await emailInput.fill("testuser@example.test");
	await passwordInput.fill("e2e-mock-password");
	await loginSubmit.click();

	// 4. Post-login redirect lands at /channels/@me and finishes gateway boot (HELLO -> READY -> GUILD_CREATE).
	await expect(page).toHaveURL(/\/channels\/@me$/);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/);

	expect(
		mockInstance.capturedRequests.some(
			(req) => req.method === "POST" && req.pathname === "/api/v9/auth/login",
		),
	).toBe(true);

	// 5. Open the fixture guild. The mock guild carries an icon hash, so the rail renders
	// img.servericon elements (an icon-less guild renders a .blankserver div instead); the
	// icon appears in more than one list, so take the visible one.
	const guildIcon = page.locator("#servers img.servericon").filter({visible: true}).first();
	await expect(guildIcon, pageErrors.join(" | ") || "no page errors").toBeVisible();
	await guildIcon.click();

	await expect(page.locator("#serverName")).toHaveText(MOCK_GUILD.properties.name);
	const channelButton = page.locator("#channels button.channelbutton", {
		hasText: MOCK_CHANNEL.name,
	});
	await expect(channelButton).toBeVisible();

	// 6. On the phone viewport, tapping the channel button slides #mainarea into view (#maintoggle:checked).
	await channelButton.click();
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);

	// 7. Fixture messages and the select component (for T2 sheet tests) are visible in the DOM.
	// Scoped to the multi-select's message: the channel also carries a single-select box.
	await expect(page.getByText("Welcome to the mock guild!", {exact: true})).toBeVisible();
	await expect(page.getByText("Choose a notification role:", {exact: true})).toBeVisible();
	await expect(
		page.locator(
			'#scrollWrap .messagediv:has-text("Choose a notification role:") .fancySelect',
		),
	).toBeVisible();
});
