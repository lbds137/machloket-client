import {expect} from "@playwright/test";
import {
	MOCK_CHANNEL,
	MOCK_GUILD,
	MOCK_GUILD_ID,
	MOCK_HIDDEN_CHANNEL_ID,
	MOCK_INSTANCE_NAME,
	loginAndOpenChannel,
	test,
} from "./fixtures";
import {type CapturedRequest} from "./mock";

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

// The deep-link boot: a bare /channels/:guildId URL (the invite accept's landing, a
// notification tap's shape) must auto-open the guild's channel, not park in a
// channelless state. The invite accept flow carries the user-facing pin in invite.spec.
test("a bare guild deep link auto-opens the guild's channel", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
});

// Class sweep, channel-shaped deep link (/channels/:guildId/:channelId): the channels
// register synchronously at GUILD_CREATE, so the URL's channel resolves without waiting
// on the member fetch - this pins that the shape boots into the named channel.
test("a channel deep link boots into the named channel", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}/${MOCK_CHANNEL.id}`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
	await expect(page.getByText("Welcome to the mock guild!", {exact: true})).toBeVisible();
});

// The deep-link landing must not just resolve the channel but OPEN the mobile chat: the
// main area rests off-canvas until #maintoggle is checked, and a boot passes no click,
// so the unresolved state parks the composer off screen (the F1 regression pin - the
// channelfocus clobber left this composer dead, which the channelname pins above
// cannot see). Mobile sends ride #mobileSend: Enter only submits above 600px.
test("a bare guild deep link lands with a working composer", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
	// The boot's open rides the checkbox's change event, so #page's class syncs with it -
	// the drawer-swipe state and the CSS slide both read these.
	await expect(page.locator("#page")).toHaveClass(/mobileMainOpen/);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.fill("hello from the deep link");
	await page.locator("#mobileSend").tap();

	// figureSubmit is not change-gated: count POSTs, exactly one send. The tap's POST
	// reaches the mock asynchronously - polled so the route capture and this read
	// can't race (phone-layout's openForm pattern).
	let sends: CapturedRequest[] = [];
	await expect
		.poll(() => {
			sends = mockInstance.capturedRequests.filter(
				(req) =>
					req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL.id}/messages`,
			);
			return sends.length;
		}, "the send must reach the mock")
		.toBe(1);
	expect((sends[0].body as {content: string}).content).toBe("hello from the deep link");
});

// A stale or deleted channel link: loadChannel falls back to the guild's default channel,
// and the landing must keep that channel focused - a re-assignment from the unknown
// segment left the composer dead and skipped the mobile open.
test("a deep link to an unknown channel lands in the fallback with a working composer", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}/1299999999999999999`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
	await expect(page.locator("#page")).toHaveClass(/mobileMainOpen/);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.fill("hello from a stale link");
	await page.locator("#mobileSend").tap();
	let sends: CapturedRequest[] = [];
	await expect
		.poll(() => {
			sends = mockInstance.capturedRequests.filter(
				(req) =>
					req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL.id}/messages`,
			);
			return sends.length;
		}, "the send must reach the mock")
		.toBe(1);
	expect((sends[0].body as {content: string}).content).toBe("hello from a stale link");
});

// A link to a channel the viewer can't see: the fallback opens the visible channel, and
// the landing must keep focus there - re-pointing it at the hidden channel would send
// the composer's messages somewhere the user can't read.
test("a deep link to a hidden channel keeps the fallback focused", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}/${MOCK_HIDDEN_CHANNEL_ID}`);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
	await expect(page.locator("#page")).toHaveClass(/mobileMainOpen/);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.fill("hello past a hidden link");
	await page.locator("#mobileSend").tap();
	const sends = () =>
		mockInstance.capturedRequests.filter((req) => req.method === "POST" && /\/messages$/.test(req.pathname));
	await expect.poll(() => sends().length, "the send must reach the mock").toBe(1);
	expect(sends()[0].pathname).toBe(`/api/v9/channels/${MOCK_CHANNEL.id}/messages`);
});

// Only the boot's landing opens the chat: a reconnect re-runs init() over the unchanged
// URL, and must leave a chat the user closed closed. The mock's invalid-session frame
// (op 9) drives the app's backoff retry, which re-identifies and re-runs init().
test("a reconnect re-init leaves a closed chat closed", async ({page, mockInstance}) => {
	await loginAndOpenChannel(page);
	await page.goto(`/channels/${MOCK_GUILD_ID}`);
	await expect(page.locator("#page")).toHaveClass(/mobileMainOpen/);

	await page.locator("#maintoggleicon").tap();
	await expect(page.locator("#page")).not.toHaveClass(/mobileMainOpen/);

	const identifies = () =>
		mockInstance.gatewayFrames.fromApp.filter((f) => (f as {op?: number}).op === 2).length;
	const before = identifies();
	mockInstance.sendGatewayEvent({op: 9, d: false});
	// Positive control: the retry really re-identified and the re-init finished its URL pass.
	await expect.poll(identifies, {timeout: 15_000}).toBeGreaterThan(before);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/);
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
	await page.waitForTimeout(500); // init()'s open would land right after the channel renders
	await expect(page.locator("#page")).not.toHaveClass(/mobileMainOpen/);
	await expect(page.locator("#maintoggle")).not.toBeChecked();
});
