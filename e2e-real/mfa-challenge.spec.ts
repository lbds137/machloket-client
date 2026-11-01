import {
	DESKTOP,
	closeSettings,
	codePrompt,
	currentTotp,
	enableTotp,
	expect,
	logIn,
	newAccount,
	openSettingsCard,
	rest,
	test,
	wrongTotp,
} from "./fixtures";

test.use(DESKTOP);

// The owner of a TOTP account deletes an application: the server asks for a second factor
// (60003), the client prompts, and the retry lands only on a right code. The proof is the
// server's own state, read back over REST.
test("deleting an application asks for a code, and a bot token reset in the same sitting does not", async ({
	page,
}) => {
	const owner = await newAccount("mfaowner");
	const secret = await enableTotp(owner);
	const doomed = await rest<{id: string; name: string}>(owner.token, "POST", "/applications", {
		name: "Doomed app",
	});
	const kept = await rest<{id: string}>(owner.token, "POST", "/applications", {
		name: "Kept app",
	});
	await rest(owner.token, "POST", `/applications/${kept.id}/bot`);

	// What the server itself says to a wrong code, so the field's error is checked against it.
	const refusal = await rest(owner.token, "POST", "/users/@me/mfa/totp", {
		code: wrongTotp(secret),
	}).catch((e: Error) => e.message);
	const refusalText = /"message":"([^"]+)"/.exec(refusal)?.[1];
	expect(refusalText, "the server's answer to a wrong code").toBeTruthy();

	await logIn(page, owner, {totpSecret: secret});
	await openSettingsCard(page, "Developer portal");

	await page.locator("#app-list-container h2", {hasText: "Doomed app"}).click();
	await page.getByRole("button", {name: "Delete Application", exact: true}).click();
	await expect(page.getByText("Are you sure you want to delete Doomed app?")).toBeVisible();
	await page.getByRole("button", {name: "Delete", exact: true}).click();

	// 60003: the client asks for a code.
	const prompt = codePrompt(page);
	await expect(prompt).toBeVisible();

	// A wrong code: the prompt stays, the refusal is on its field, nothing was deleted.
	await prompt.locator("input").fill(wrongTotp(secret));
	await prompt.getByRole("button", {name: "Submit", exact: true}).click();
	await expect(prompt.locator(".suberror")).toHaveText(refusalText!);
	await expect(prompt).toBeVisible();
	const stillThere = await rest<{id: string}>(owner.token, "GET", `/applications/${doomed.id}`);
	expect(stillThere.id).toBe(doomed.id);

	// A right code: the retry lands.
	await prompt.locator("input").fill(await currentTotp(secret));
	await prompt.getByRole("button", {name: "Submit", exact: true}).click();
	await expect(prompt).toHaveCount(0);
	await expect
		.poll(async () => {
			const apps = await rest<{id: string}[]>(owner.token, "GET", "/applications");
			return apps.map((a) => a.id);
		})
		.toEqual([kept.id]);

	// The same sitting: the minted token is reused, so a bot token reset opens no prompt.
	// Deleting hid the whole application list, so reopen settings (no reload: the minted token
	// lives in memory).
	await closeSettings(page);
	await openSettingsCard(page, "Developer portal");
	await page.locator("#app-list-container h2", {hasText: "Kept app"}).click();
	await page.getByRole("button", {name: "Manage bot", exact: true}).click();
	await page.getByRole("button", {name: "Reset token", exact: true}).first().click();
	await page.getByRole("button", {name: "Reset token", exact: true}).last().click();
	const shown = page.getByText(/^Token: [A-Za-z0-9._-]{20,}$/);
	await expect(shown).toBeVisible();
	await expect(codePrompt(page)).toHaveCount(0);

	// And the server agrees: the token on the page is the bot's new, working one.
	const token = (await shown.textContent())!.replace(/^Token: /, "");
	const bot = await rest<{id: string; bot: boolean}>(token, "GET", "/users/@me");
	expect(bot.id).toBe(kept.id);
	expect(bot.bot).toBe(true);
});
