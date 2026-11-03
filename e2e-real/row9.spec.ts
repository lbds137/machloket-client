import type {Page} from "@playwright/test";
import {
	BotGateway,
	DESKTOP,
	answerInteraction,
	channelRowText,
	expect,
	logIn,
	newAccount,
	openOnlyGuildChannel,
	rest,
	test,
	type RealAccount,
} from "./fixtures";

// The /row9 walk against a real server: a bot on its own gateway session serves a slash
// command, its components and a modal, and the server's routing and rules decide the outcome.
// The feel, the real keyboard and Discord's own look stay outside this file.

const USE_APPLICATION_COMMANDS = 1n << 31n;
const EPHEMERAL = 64;

const REPLY_COMPONENTS = [
	{
		type: 1,
		components: [
			{type: 2, style: 1, label: "go", custom_id: "go"},
			{type: 2, style: 2, label: "open form", custom_id: "form"},
			{type: 2, style: 2, label: "silent", custom_id: "silent"},
		],
	},
	{
		type: 1,
		components: [
			{
				type: 3,
				custom_id: "one",
				placeholder: "pick one",
				options: [
					{label: "Alpha", value: "alpha"},
					{label: "Beta", value: "beta"},
				],
			},
		],
	},
	{
		type: 1,
		components: [
			{
				type: 3,
				custom_id: "many",
				placeholder: "pick some",
				min_values: 1,
				max_values: 2,
				options: [
					{label: "Red", value: "red"},
					{label: "Green", value: "green"},
					{label: "Blue", value: "blue"},
				],
			},
		],
	},
];

interface World {
	owner: RealAccount;
	member: RealAccount;
	guildId: string;
	channelId: string;
	channelName: string;
	bot: BotGateway;
	close(): void;
}

/** A guild with a plain member, and a bot serving `/row9 note:<text>` in it. */
async function setUp(): Promise<World> {
	const owner = await newAccount("rowowner");
	const member = await newAccount("rowmember");
	const guild = await rest<{id: string}>(owner.token, "POST", "/guilds", {name: "Row 9"});
	const channels = await rest<{id: string; name: string; type: number}[]>(
		owner.token,
		"GET",
		`/guilds/${guild.id}/channels`,
	);
	const channel = channels.find((c) => c.type === 0)!;
	const invite = await rest<{code: string}>(
		owner.token,
		"POST",
		`/channels/${channel.id}/invites`,
		{},
	);
	await rest(member.token, "POST", `/invites/${invite.code}`, {});

	const app = await rest<{id: string}>(owner.token, "POST", "/applications", {name: "Row 9 app"});
	const {token} = await rest<{token: string}>(
		owner.token,
		"POST",
		`/applications/${app.id}/bot`,
		{},
	);
	await rest(owner.token, "POST", `/oauth2/authorize?client_id=${app.id}&scope=bot`, {
		authorize: true,
		guild_id: guild.id,
		permissions: "0",
	});
	await rest(`Bot ${token}`, "PUT", `/applications/${app.id}/guilds/${guild.id}/commands`, [
		{
			name: "row9",
			type: 1,
			description: "probe",
			options: [{name: "note", type: 3, description: "any note", required: true}],
		},
	]);
	const bot = await BotGateway.connect(token);
	return {
		owner,
		member,
		guildId: guild.id,
		channelId: channel.id,
		channelName: channel.name,
		bot,
		close: () => bot.close(),
	};
}

/** Types into the composer, char by char as a person does. */
async function openPopup(page: Page, text = "/"): Promise<void> {
	const typebox = page.locator("#typebox");
	await typebox.click();
	await typebox.pressSequentially(text);
}

/** Clears the composer of whatever the last popup probe typed. */
async function clearComposer(page: Page): Promise<void> {
	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.press("Control+A");
	await page.keyboard.press("Backspace");
	await expect(page.locator("#searchOptions")).toBeEmpty();
}

/** The next frame after an awaited answer, by when a row would be on the page. An empty list
 * draws nothing to wait for (renderCommandPanel), so each negative stands on the same test
 * seeing the row while it was allowed. */
async function settle(page: Page): Promise<void> {
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));
}

const popupRow = (page: Page) => page.locator("#searchOptions .commandRow", {hasText: "/row9"});

/** Runs `/row9 note:<note>` through the popup and returns what the bot received. */
async function runRow9(page: Page, world: World, note: string) {
	await openPopup(page, "/row9");
	await popupRow(page).click();
	const field = page.locator('.commandinput[commandname="note"] input');
	await field.fill(note);
	// A phone's Enter is a newline: the send button sends.
	await page.locator("#mobileSend").tap();
	return world.bot.next();
}

test("a command the validator refuses names the field it rejected", async ({page}) => {
	const world = await setUp();
	try {
		await logIn(page, world.member);
		await openOnlyGuildChannel(page, world.channelName);
		// The client sends nothing the schema refuses, so the one extra field goes in on the way.
		await page.route("**/api/v9/interactions", (route) =>
			route.continue({
				postData: JSON.stringify({...route.request().postDataJSON(), not_a_field: true}),
			}),
		);

		await openPopup(page, "/row9");
		await popupRow(page).click();
		await page.locator('.commandinput[commandname="note"] input').fill("x");
		await page.locator("#mobileSend").tap();

		await expect(page.locator(".commandError")).toHaveText("400: Invalid Form Body (not_a_field)");
	} finally {
		world.close();
	}
});

test("the walk: popup, option, reply, button, ephemeral, selects, modal", async ({
	page,
	extraPage,
}) => {
	const world = await setUp();
	try {
		await logIn(page, world.member);
		await openOnlyGuildChannel(page, world.channelName);

		// The owner watches the same channel: what's ephemeral must not reach their session.
		const ownerPage = await extraPage();
		await logIn(ownerPage, world.owner);
		await openOnlyGuildChannel(ownerPage, world.channelName);

		const command = await runRow9(page, world, "hello");
		expect(command.type).toBe(2);
		expect(command.data.name).toBe("row9");
		expect(command.data.options).toEqual([expect.objectContaining({name: "note", value: "hello"})]);

		await expect(page.locator(".commandStatus")).toHaveText("Processing interaction…");
		await answerInteraction(command, {
			type: 4,
			data: {content: "row9 reply: hello", components: REPLY_COMPONENTS},
		});
		const reply = page.locator(".messagediv", {hasText: "row9 reply: hello"});
		await expect(reply).toBeVisible();
		await expect(page.locator(".commandStatus")).toHaveText("");
		await expect(ownerPage.locator(".messagediv", {hasText: "row9 reply: hello"})).toBeVisible();

		// A button, answered with an ephemeral.
		await reply.getByRole("button", {name: "go", exact: true}).tap();
		const pressed = await world.bot.next();
		expect(pressed.type).toBe(3);
		expect(pressed.data.custom_id).toBe("go");
		await answerInteraction(pressed, {
			type: 4,
			data: {content: "button go received", flags: EPHEMERAL},
		});
		const ephemeral = page.locator(".messagediv", {hasText: "button go received"});
		await expect(ephemeral).toContainText("Only you can see this message");
		await ephemeral.getByText("Dismiss message", {exact: true}).tap();
		await expect(ephemeral).toHaveCount(0);

		// A single select: the tap is the answer, the reply is public.
		await reply.locator(".fancySelect input").first().tap();
		const sheet = page.locator(".selectSheetBackdrop .selectSheet");
		await sheet.locator(".selectSheetRow", {hasText: "Beta"}).tap();
		const single = await world.bot.next();
		expect(single.type).toBe(3);
		expect(single.data.custom_id).toBe("one");
		expect(single.data.values).toEqual(["beta"]);
		await answerInteraction(single, {type: 4, data: {content: "picked beta"}});
		await expect(ownerPage.locator(".messagediv", {hasText: "picked beta"})).toBeVisible();
		// The public reply reached them after the ephemeral was sent, so a leak would be here.
		await expect(ownerPage.locator(".messagediv", {hasText: "button go received"})).toHaveCount(0);

		// A multi select: Apply sends, and the bot updates the message in place.
		await reply.locator(".fancySelect input").last().tap();
		await sheet.locator(".selectSheetRow", {hasText: "Red"}).tap();
		await sheet.locator(".selectSheetRow", {hasText: "Blue"}).tap();
		await sheet.getByRole("button", {name: "Apply"}).tap();
		const multi = await world.bot.next();
		expect(multi.data.custom_id).toBe("many");
		expect(multi.data.values).toEqual(["red", "blue"]);
		await answerInteraction(multi, {
			type: 7,
			data: {content: "row9 updated", components: REPLY_COMPONENTS},
		});
		const updated = page.locator(".messagediv", {hasText: "row9 updated"});
		await expect(updated).toBeVisible();
		await expect(page.locator(".messagediv", {hasText: "row9 reply: hello"})).toHaveCount(0);

		// A button that opens a modal; its submit is an interaction of its own.
		await updated.getByRole("button", {name: "open form", exact: true}).tap();
		const opener = await world.bot.next();
		expect(opener.data.custom_id).toBe("form");
		await answerInteraction(opener, {
			type: 9,
			data: {
				custom_id: "row9form",
				title: "Row 9 form",
				components: [
					{
						type: 1,
						components: [
							{type: 4, custom_id: "field", label: "Say something", style: 1, required: true},
						],
					},
				],
			},
		});
		const dialog = page.locator(".dialogModal");
		await expect(dialog).toContainText("Row 9 form");
		await dialog.locator('[data-custom-id="field"]').fill("from the form");
		await dialog.locator(".interactionModalSubmit").tap();
		const submitted = await world.bot.next();
		expect(submitted.type).toBe(5);
		expect(submitted.data.custom_id).toBe("row9form");
		expect(JSON.stringify(submitted.data.components)).toContain("from the form");
		await answerInteraction(submitted, {type: 4, data: {content: "form said: from the form"}});
		await expect(dialog).toHaveCount(0);
		await expect(page.locator(".messagediv", {hasText: "form said: from the form"})).toBeVisible();
	} finally {
		world.close();
	}
});

test("a bot that doesn't answer: the server's timeout reaches the command and the button", async ({
	page,
}) => {
	const world = await setUp();
	try {
		await logIn(page, world.member);
		await openOnlyGuildChannel(page, world.channelName);

		const answered = await runRow9(page, world, "first");
		await answerInteraction(answered, {
			type: 4,
			data: {content: "row9 reply: first", components: REPLY_COMPONENTS},
		});
		const reply = page.locator(".messagediv", {hasText: "row9 reply: first"});
		await expect(reply).toBeVisible();

		// The command's failure is a local ephemeral in the channel.
		await runRow9(page, world, "ignored");
		await expect(
			page.locator(".messagediv", {hasText: "The application did not respond"}),
		).toBeVisible({timeout: 20_000});

		await reply.getByRole("button", {name: "silent", exact: true}).tap();
		await world.bot.next();
		// A component's failure is its message's own line, gone again after a moment.
		await expect(reply).toContainText("Interaction failed", {timeout: 20_000});
	} finally {
		world.close();
	}
});

test("losing USE_APPLICATION_COMMANDS empties the popup live, and the server refuses", async ({
	page,
}) => {
	const world = await setUp();
	try {
		await logIn(page, world.member);
		await openOnlyGuildChannel(page, world.channelName);

		await openPopup(page);
		await expect(popupRow(page)).toBeVisible();
		await clearComposer(page);

		const roles = await rest<{id: string; permissions: string}[]>(
			world.owner.token,
			"GET",
			`/guilds/${world.guildId}/roles`,
		);
		const everyone = roles.find((role) => role.id === world.guildId)!;
		const bits = BigInt(everyone.permissions);
		expect(bits & USE_APPLICATION_COMMANDS).toBe(USE_APPLICATION_COMMANDS);
		const index = await rest<{application_commands: {id: string; application_id: string}[]}>(
			world.member.token,
			"GET",
			`/guilds/${world.guildId}/application-command-index`,
		);
		await rest(world.owner.token, "PATCH", `/guilds/${world.guildId}/roles/${everyone.id}`, {
			permissions: String(bits & ~USE_APPLICATION_COMMANDS),
		});

		const [command] = index.application_commands;
		await expect(
			rest(world.member.token, "POST", "/interactions", {
				type: 2,
				application_id: command.application_id,
				guild_id: world.guildId,
				channel_id: world.channelId,
				nonce: "1",
				session_id: "e2e",
				data: {
					id: command.id,
					name: "row9",
					type: 1,
					options: [{name: "note", type: 3, value: "x"}],
				},
			}),
		).rejects.toThrow(/50013/);

		// The role change reaches the open session, so no reload.
		await expect
			.poll(async () => {
				await openPopup(page);
				await settle(page);
				const shown = await page.locator("#searchOptions").textContent();
				await clearComposer(page);
				return shown;
			})
			.not.toContain("/row9");
	} finally {
		world.close();
	}
});

test.describe("an archived thread", () => {
	test.use(DESKTOP);

	async function threadMenu(page: Page, name: string) {
		await page
			.locator("#channels button.channelbutton", {hasText: channelRowText(name)})
			.click({button: "right"});
		const menu = page.locator(".contextmenu");
		await expect(menu).toBeVisible();
		const labels = await menu.locator("button").allTextContents();
		// A click outside closes it; the channel's name in the header does nothing else.
		await page.locator("#channelname").click();
		await expect(menu).toHaveCount(0);
		return labels;
	}

	// The non-member is a viewer who never joined: the fix's reading is that the server keeps
	// sending them the thread's updates anyway, archived or not.
	for (const {who, joined, action} of [
		{who: "a non-member", joined: false, action: "Join thread"},
		{who: "a member of the thread", joined: true, action: "Leave thread"},
	]) {
		test(`takes commands and ${action} away from ${who}, and a send brings them back`, async ({
			page,
		}) => {
			const world = await setUp();
			try {
				const threadName = "row9-thread";
				const thread = await rest<{id: string}>(
					world.owner.token,
					"POST",
					`/channels/${world.channelId}/threads`,
					{name: threadName, type: 11, auto_archive_duration: 1440},
				);
				if (joined) {
					await rest(world.member.token, "PUT", `/channels/${thread.id}/thread-members/@me`);
				}
				await logIn(page, world.member);
				// A thread the viewer hasn't joined has no sidebar row until it's open.
				await page.goto(`/channels/${world.guildId}/${thread.id}`);
				await expect(page.locator("#channelname")).toContainText(threadName);

				await openPopup(page);
				await expect(popupRow(page)).toBeVisible();
				await clearComposer(page);
				expect(await threadMenu(page, threadName)).toContain(action);

				await rest(world.owner.token, "PATCH", `/channels/${thread.id}`, {archived: true});

				await expect.poll(() => threadMenu(page, threadName)).not.toContain(action);
				await openPopup(page);
				await settle(page);
				await expect(page.locator("#searchOptions")).not.toContainText("/row9");
				await clearComposer(page);

				// Another user's send unarchives it (the server's rule), and the open session hears.
				await rest(world.owner.token, "POST", `/channels/${thread.id}/messages`, {content: "back"});

				await expect.poll(() => threadMenu(page, threadName)).toContain(action);
				await openPopup(page);
				await expect(popupRow(page)).toBeVisible();
			} finally {
				world.close();
			}
		});
	}
});
