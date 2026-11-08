import {
	DESKTOP,
	addVirtualAuthenticator,
	codePrompt,
	currentTotp,
	expect,
	expectLoggedIn,
	instanceSql,
	logIn,
	newAccount,
	newTotpSecret,
	openSettingsCard,
	submitLogin,
	test,
	type RealAccount,
} from "./fixtures";
import type {Locator, Page} from "@playwright/test";

test.use(DESKTOP);

const screen = (page: Page) => page.locator(".dialogModal", {has: page.locator(".backupCodeGrid")});

/** Through the open key menu, with the account's password. */
async function addKey(page: Page, me: RealAccount, name: string): Promise<void> {
	await page.getByRole("button", {name: "Add key", exact: true}).click();
	const form = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Submit", exact: true}),
	});
	await form
		.locator("div", {has: page.getByText("Password:", {exact: true})})
		.locator("input[type=password]")
		.last()
		.fill(me.password);
	await form
		.locator("div", {has: page.getByText("Key name:", {exact: true})})
		.locator("input")
		.last()
		.fill(name);
	await form.getByRole("button", {name: "Submit", exact: true}).click();
	await expect(page.getByRole("button", {name, exact: true})).toBeVisible();
}

// The browser's own key sheet can't be cancelled from here: this is its answer to a cancel.
const cancelKeyPrompt = () =>
	(navigator.credentials.get = () =>
		Promise.reject(new DOMException("cancelled", "NotAllowedError")));

/** The codes on the screen, after checking a stray Escape leaves them up, then closes it. */
async function takeCodes(page: Page): Promise<string[]> {
	const shown = screen(page);
	await expect(shown).toBeVisible();
	const codes = await shown.locator(".backupCodeGrid code").allTextContents();
	expect(codes.length).toBeGreaterThan(1);
	for (const code of codes) expect(code).toMatch(/^[0-9a-f]{8}$/);
	await page.keyboard.press("Escape");
	await expect(shown).toBeVisible();
	await shown.getByRole("button", {name: "I've saved them", exact: true}).click();
	await expect(shown).toHaveCount(0);
	return codes;
}

async function submitCode(prompt: Locator, code: string): Promise<void> {
	await prompt.locator("input").fill(code);
	await prompt.getByRole("button", {name: "Submit", exact: true}).click();
}

// The server decides what a code is good for: it mints them, spends them, and refuses a reuse.
test("TOTP set up in settings shows its codes on setup; one logs in, mangled as a paste would, and is spent", async ({
	page,
	extraPage,
}) => {
	const me = await newAccount("codestotp");
	await logIn(page, me);
	await openSettingsCard(page, "Account settings");
	await page.getByRole("button", {name: "Enable 2FA", exact: true}).click();

	const form = page.locator(".FormSettings", {
		has: page.getByText("Your TOTP secret is:", {exact: false}),
	});
	const secret = /secret is: ([A-Z2-7]+)\./.exec(
		(await form.getByText("Your TOTP secret is:", {exact: false}).textContent())!,
	)![1];
	await form
		.locator("div", {has: page.getByText("Password", {exact: true})})
		.locator("input[type=password]")
		.last()
		.fill(me.password);
	await form
		.locator("div", {has: page.getByText("Code:", {exact: true})})
		.locator("input")
		.last()
		.fill(await currentTotp(secret));
	await form.getByRole("button", {name: "Submit", exact: true}).click();

	const [first, second] = await takeCodes(page);

	const away = await extraPage();
	await submitLogin(away, me);
	const prompt = codePrompt(away);
	await expect(prompt).toBeVisible({timeout: 30_000});
	await expect(prompt.getByText("You can also use a backup code.", {exact: true})).toBeVisible();
	await submitCode(prompt, ` ${first.slice(0, 4).toUpperCase()}-${first.slice(4).toUpperCase()} `);
	await expectLoggedIn(away);

	await test.step("the spent code is refused, the next one works", async () => {
		const again = await extraPage();
		await submitLogin(again, me);
		const secondPrompt = codePrompt(again);
		await expect(secondPrompt).toBeVisible({timeout: 30_000});
		await submitCode(secondPrompt, first);
		await expect(secondPrompt.locator(".suberror")).toBeVisible();
		await expect(secondPrompt).toBeVisible();
		await submitCode(secondPrompt, second);
		await expectLoggedIn(again);
	});
});

test("a first key shows codes and a second doesn't; a cancelled key prompt at login takes a code", async ({
	page,
	extraPage,
}) => {
	const me = await newAccount("codeskey");
	await addVirtualAuthenticator(page);
	await logIn(page, me);
	await openSettingsCard(page, "Account settings");
	await page.getByRole("button", {name: "Manage security keys", exact: true}).click();

	await addKey(page, me, "Key one");
	const [code] = await takeCodes(page);

	await addKey(page, me, "Key two");
	await expect(screen(page)).toHaveCount(0);

	const away = await extraPage();
	await away.addInitScript(cancelKeyPrompt);
	await submitLogin(away, me);
	const prompt = away.locator(".dialogModal", {
		has: away.getByText("Enter a backup code:", {exact: true}),
	});
	await expect(prompt).toBeVisible({timeout: 30_000});
	await submitCode(prompt, code);
	await expectLoggedIn(away);

	await test.step("on a key-only account the spent code is refused too", async () => {
		const again = await extraPage();
		await again.addInitScript(cancelKeyPrompt);
		await submitLogin(again, me);
		const secondPrompt = again.locator(".dialogModal", {
			has: again.getByText("Enter a backup code:", {exact: true}),
		});
		await expect(secondPrompt).toBeVisible({timeout: 30_000});
		await submitCode(secondPrompt, code);
		await expect(secondPrompt.locator(".suberror")).toBeVisible();
	});
});

// The server's `totp` flag decides this: with the codes gone, `backup` alone would strand the account.
test("a key + authenticator account is offered its code at a cancelled key prompt, even with no backup codes left", async ({
	page,
	extraPage,
}) => {
	const me = await newAccount("keytotp");
	await addVirtualAuthenticator(page);
	await logIn(page, me);
	await openSettingsCard(page, "Account settings");
	await page.getByRole("button", {name: "Manage security keys", exact: true}).click();
	await addKey(page, me, "Key one");
	await takeCodes(page);

	// Adding the authenticator over a key asks for the key: not this spec's subject.
	const secret = newTotpSecret();
	instanceSql(
		`UPDATE users SET totp_secret = '${secret}', mfa_enabled = true WHERE id = '${me.id}'`,
	);

	await test.step("with codes left, either kind is offered", async () => {
		const both = await extraPage();
		await both.addInitScript(cancelKeyPrompt);
		await submitLogin(both, me);
		const prompt = both.locator(".dialogModal", {
			has: both.getByText("Enter a code:", {exact: true}),
		});
		await expect(prompt).toBeVisible({timeout: 30_000});
	});

	instanceSql(`UPDATE backup_codes SET expired = true WHERE user_id = '${me.id}'`);

	const away = await extraPage();
	await away.addInitScript(cancelKeyPrompt);
	await submitLogin(away, me);
	const prompt = away.locator(".dialogModal", {
		has: away.getByText("Enter your authenticator code:", {exact: true}),
	});
	await expect(prompt).toBeVisible({timeout: 30_000});
	await submitCode(prompt, await currentTotp(secret));
	await expectLoggedIn(away);
});
