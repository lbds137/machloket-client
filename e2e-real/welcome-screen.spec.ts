import type {Page} from "@playwright/test";
import {
	DESKTOP,
	expect,
	logIn,
	newAccount,
	openSettingsCard,
	rest,
	test,
	type RealAccount,
} from "./fixtures";

test.use(DESKTOP);

type Channel = {id: string; name: string; type: number};
type Welcome = {
	enabled: boolean;
	description: string | null;
	welcome_channels: {
		channel_id: string;
		description: string;
		emoji_id?: string | null;
		emoji_name?: string | null;
	}[];
};

async function textChannels(token: string, guildId: string): Promise<Channel[]> {
	const all = await rest<Channel[]>(token, "GET", `/guilds/${guildId}/channels`);
	return all.filter((c) => c.type === 0);
}

/** Joins through the app's own "+" dialog, so the live gateway session gets GUILD_CREATE. */
async function joinByCode(page: Page, code: string): Promise<void> {
	await page.locator("#servers .home.servericon:has(.svg-plus)").click();
	const dialog = page.locator(".dialogModal", {
		has: page.getByText("Invite link/code", {exact: true}),
	});
	await dialog.locator("input[type=text]").last().fill(code);
	await dialog.getByRole("button", {name: "Submit", exact: true}).click();
}

test("a welcome screen set up in the editor greets a new member, and one with no channels left stays quiet", async ({
	page,
	extraPage,
}) => {
	const owner = await newAccount("welcomeowner");
	const guild = await rest<{id: string}>(owner.token, "POST", "/guilds", {name: "Greeters"});
	const general = (await textChannels(owner.token, guild.id))[0];
	const rules = await rest<Channel>(owner.token, "POST", `/guilds/${guild.id}/channels`, {
		name: "rules",
		type: 0,
	});
	const chat = await rest<Channel>(owner.token, "POST", `/guilds/${guild.id}/channels`, {
		name: "chat",
		type: 0,
	});
	const invite = await rest<{code: string}>(
		owner.token,
		"POST",
		`/channels/${general.id}/invites`,
		{},
	);

	await test.step("the owner sets the screen up in guild settings", async () => {
		await logIn(page, owner);
		await page.locator("#servers .blankserver.servericon").first().click({button: "right"});
		await page.locator(".contextmenu").getByText("Settings", {exact: true}).click();
		await openSettingsCard(page, "Onboarding");

		await page.getByRole("button", {name: "Enable onboarding", exact: true}).click();
		const enable = page.locator(".dialogModal", {
			has: page.getByText("Description:", {exact: true}),
		});
		await enable.locator("input[type=text]").last().fill("Say hello and read the rules");
		await enable.getByRole("button", {name: "Submit", exact: true}).click();
		await expect(page.getByRole("button", {name: "Disable onboarding", exact: true})).toBeVisible();

		const addChannel = async (name: string, description: string, emoji?: string) => {
			await page.getByRole("button", {name: "Add channel", exact: true}).click();
			const dialog = page.locator(".dialogModal", {
				has: page.getByText("Channel:", {exact: true}),
			});
			await dialog.locator("select").selectOption({label: name});
			await dialog
				.locator("div", {has: page.getByText("Description:", {exact: true})})
				.locator("input[type=text]")
				.last()
				.fill(description);
			if (emoji) {
				await dialog.locator(".emojiForm").click();
				await page
					.locator(".emojiPicker .emojiBody .emojiSelect", {hasText: emoji})
					.first()
					.click();
				await expect(dialog.locator(".emojiForm")).toContainText(emoji);
			}
			await dialog.getByRole("button", {name: "Submit", exact: true}).click();
			await expect(dialog).toHaveCount(0);
		};
		await addChannel("rules", "Read these first", "\u{1F600}");
		await addChannel("chat", "Talk about anything");

		// The server holds what the editor saved.
		const stored = await rest<Welcome>(owner.token, "GET", `/guilds/${guild.id}/welcome-screen`);
		expect(stored.enabled).toBe(true);
		expect(stored.description).toBe("Say hello and read the rules");
		expect(stored.welcome_channels).toHaveLength(2);
		const storedRules = stored.welcome_channels.find((c) => c.channel_id === rules.id);
		expect(storedRules?.description).toBe("Read these first");
		expect(storedRules?.emoji_name).toBe("\u{1F600}");
		const storedChat = stored.welcome_channels.find((c) => c.channel_id === chat.id);
		expect(storedChat?.description).toBe("Talk about anything");
		expect(storedChat?.emoji_name ?? null).toBeNull();
	});

	await test.step("a member who joins by invite sees the dialog", async () => {
		const member = await newAccount("welcomemember");
		const memberPage = await extraPage();
		await logIn(memberPage, member);
		await joinByCode(memberPage, invite.code);

		const dialog = memberPage.locator(".dialogModal", {
			has: memberPage.getByText("Welcome to Greeters!", {exact: false}),
		});
		await expect(dialog).toBeVisible({timeout: 30_000});
		await expect(dialog).toContainText("Say hello and read the rules");
		await expect(dialog.getByRole("button", {name: "rules", exact: true})).toBeVisible();
		await expect(dialog.getByRole("button", {name: "chat", exact: true})).toBeVisible();
		await expect(dialog).toContainText("Read these first");
		await expect(dialog).toContainText("Talk about anything");
		await expect(dialog).toContainText("\u{1F600}");

		// A row opens its channel.
		await dialog.getByRole("button", {name: "rules", exact: true}).click();
		await expect(memberPage.locator("#channelname")).toHaveText("#rules");
	});

	await test.step("a guild whose welcome channels were all deleted opens no dialog", async () => {
		const quiet = await rest<{id: string}>(owner.token, "POST", "/guilds", {name: "Quiet"});
		const quietGeneral = (await textChannels(owner.token, quiet.id))[0];
		const gone = await rest<Channel>(owner.token, "POST", `/guilds/${quiet.id}/channels`, {
			name: "gone",
			type: 0,
		});
		await rest(owner.token, "PATCH", `/guilds/${quiet.id}/welcome-screen`, {
			enabled: true,
			description: "Nobody will see this",
			welcome_channels: [{channel_id: gone.id, description: "Soon deleted"}],
		});
		await rest(owner.token, "DELETE", `/channels/${gone.id}`);
		const stillEnabled = await rest<Welcome>(
			owner.token,
			"GET",
			`/guilds/${quiet.id}/welcome-screen`,
		);
		expect(stillEnabled.enabled, "the server still serves an enabled screen").toBe(true);
		expect(
			stillEnabled.welcome_channels.map((row) => row.channel_id),
			"and still lists the deleted channel, so only the client's guard can hold the dialog back",
		).toEqual([gone.id]);
		const quietInvite = await rest<{code: string}>(
			owner.token,
			"POST",
			`/channels/${quietGeneral.id}/invites`,
			{},
		);

		const third: RealAccount = await newAccount("welcomethird");
		const thirdPage = await extraPage();
		await logIn(thirdPage, third);
		const welcomeFetched = thirdPage.waitForResponse(
			(res) =>
				res.request().method() === "GET" &&
				res.url().includes(`/guilds/${quiet.id}/welcome-screen`),
		);
		await joinByCode(thirdPage, quietInvite.code);
		// Positive barriers: the screen's body has arrived and the guild opened. showWelcome then
		// runs to its dialog in microtasks, so a macrotask later a dialog would already exist.
		await (await welcomeFetched).finished();
		await expect(thirdPage.locator("#serverName")).toHaveText("Quiet");
		await thirdPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
		await expect(thirdPage.getByText("Welcome to Quiet!", {exact: false})).toHaveCount(0);
		await expect(thirdPage.locator(".dialogModal")).toHaveCount(0);
	});
});
