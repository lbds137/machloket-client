import {DESKTOP, expect, logIn, newAccount, openOnlyGuildChannel, rest, test} from "./fixtures";

test.use(DESKTOP);

// The server's limit and its reason, as it says them: 4000 fits, 4001 is a 50035 whose message
// sits at errors.content._errors[0]. The client knows no limit, so it finds out from the refusal.
const LIMIT = 4000;
const REASON = "Must be 4000 or fewer in length.";

test("over the limit: a send and an edit are refused with the server's reason, and the text stays", async ({
	page,
}) => {
	const me = await newAccount("limit");
	const guild = await rest<{id: string}>(me.token, "POST", "/guilds", {name: "Limit"});
	const channels = await rest<{id: string; name: string; type: number}[]>(
		me.token,
		"GET",
		`/guilds/${guild.id}/channels`,
	);
	const channel = channels.find((c) => c.type === 0)!;
	const history = () =>
		rest<{content: string}[]>(me.token, "GET", `/channels/${channel.id}/messages?limit=5`);
	await logIn(page, me);
	await openOnlyGuildChannel(page, channel.name);

	const typebox = page.locator("#typebox");
	const tooLong = "x".repeat(LIMIT + 1);
	await typebox.fill(tooLong);
	await page.keyboard.press("Enter");

	await expect(page.getByText(REASON)).toBeVisible();
	await expect(typebox).toHaveText(tooLong);
	expect(await history()).toEqual([]);

	// Exactly the limit goes through.
	const fits = "y".repeat(LIMIT);
	await typebox.fill(fits);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await history()).map((m) => m.content)).toEqual([fits]);

	const sent = page.locator(".messagediv", {hasText: "yyy"}).first();
	await sent.hover();
	await sent.locator(".messageButtons .svg-edit").click();
	const editor = page.locator(".editMessage");
	await editor.fill(tooLong);
	await editor.press("Enter");

	await expect(page.getByText(REASON).last()).toBeVisible();
	await expect(editor).toHaveText(tooLong);
	expect((await history()).map((m) => m.content)).toEqual([fits]);
});
