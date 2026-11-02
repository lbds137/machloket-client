import {
	DESKTOP,
	enableTotp,
	expect,
	logIn,
	newAccount,
	rest,
	seedMfaRecovery,
	test,
} from "./fixtures";

test.use(DESKTOP);

const bar = "#recoveryBanner";

// The server's own answers decide these: its GET's shape and date format, its 404, and its event
// reaching another live session. The hold itself is seeded: an operator's CLI has no route, and
// the notice sweep runs every 5 minutes.
test("an account with nothing pending gets no warning", async ({page}) => {
	const me = await newAccount("norecovery");
	const answer = page.waitForResponse((res) => res.url().endsWith("/users/@me/mfa/recovery"));
	await logIn(page, me);
	expect((await answer).status()).toBe(404);
	await expect(page.locator(bar)).toBeHidden();
});

test("a hold not yet notified warns with no countdown", async ({page}) => {
	const me = await newAccount("recoveryuntimed");
	seedMfaRecovery(me.id, null);
	await logIn(page, me);
	await expect(page.locator(bar)).toContainText("If this wasn't you, cancel it now.");
	await expect(page.locator(`${bar}When`)).toBeHidden();
});

test("a running hold shows its time left; cancelling on one session clears the other through the server's event", async ({
	page,
	extraPage,
}) => {
	const me = await newAccount("recoverycancel");
	seedMfaRecovery(me.id, new Date(Date.now() + 72 * 3_600_000));

	await logIn(page, me);
	const other = await extraPage();
	await logIn(other, me);

	await expect(page.locator(`${bar}When`)).toHaveText(/^in 7[12] hours$/);
	await expect(other.locator(bar)).toBeVisible();

	await page.getByRole("button", {name: "Cancel removal"}).click();
	await expect(page.locator(bar)).toBeHidden();
	await expect(other.locator(bar)).toBeHidden();

	await expect(rest(me.token, "GET", "/users/@me/mfa/recovery")).rejects.toThrow(/: 404 /);
});

// A hold is what a recovery is for, so its account usually holds a factor. The server's DELETE
// asks for no code on it, and this is where that reading runs.
test("cancelling needs no second factor on an account with an authenticator", async ({page}) => {
	const me = await newAccount("recoverytotp");
	const secret = await enableTotp(me);
	seedMfaRecovery(me.id, new Date(Date.now() + 72 * 3_600_000));
	await logIn(page, me, {totpSecret: secret});
	await expect(page.locator(bar)).toBeVisible();

	await page.getByRole("button", {name: "Cancel removal"}).click();

	await expect(page.locator(bar)).toBeHidden();
	await expect(rest(me.token, "GET", "/users/@me/mfa/recovery")).rejects.toThrow(/: 404 /);
});
