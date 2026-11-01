import type {Page} from "@playwright/test";
import {expect, logIn, newAccount, openOnlyGuildChannel, rest, test} from "./fixtures";

type Message = {content: string; author: {id: string}; attachments: unknown[]};

/** Through the dock's own account menu and the switcher, as a person would. */
async function switchTo(page: Page, username: string): Promise<void> {
	// On a phone the chat covers the dock: go back to the sidebar first.
	const toggle = page.locator("#maintoggle");
	if (await toggle.isChecked().catch(() => false)) {
		await page.locator("#maintoggleicon").tap();
		await expect(toggle).not.toBeChecked();
	}
	await page.locator("#userinfo").click({button: "right"});
	await page.locator(".contextmenu").getByText("Switch accounts", {exact: false}).click();
	await page.locator(".accountSwitcher .switchtable", {hasText: username}).click();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 30_000});
	await expect(page.locator("#username")).toHaveText(username);
}

/** Two accounts of one guild, both known to the client; an attachment staged on A latches the
 * send button on, and the client is switched to B. */
async function stagedOnAThenSwitchedToB(page: Page) {
	const a = await newAccount("latcha");
	const b = await newAccount("latchb");
	const guild = await rest<{id: string}>(a.token, "POST", "/guilds", {name: "Latch"});
	const channels = await rest<{id: string; type: number; name: string}[]>(
		a.token,
		"GET",
		`/guilds/${guild.id}/channels`,
	);
	const channel = channels.find((c) => c.type === 0)!;
	const invite = await rest<{code: string}>(a.token, "POST", `/channels/${channel.id}/invites`, {});
	await rest(b.token, "POST", `/invites/${invite.code}`, {});

	await logIn(page, a);
	await logIn(page, b);
	await switchTo(page, a.username);
	await openOnlyGuildChannel(page, channel.name);

	const composer = page.locator(".outerTypeBox");
	await expect(composer).toHaveClass(/noConent/);
	await page.locator("#upload").click();
	const chooser = page.waitForEvent("filechooser");
	await page.locator(".contextmenu").getByText("Upload files", {exact: true}).click();
	await (
		await chooser
	).setFiles({
		name: "latched.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("staged on account A"),
	});
	await expect(page.locator("#pasteimage > *")).toHaveCount(1);
	// The latch: the send button shows for an attachment alone.
	await expect(composer).not.toHaveClass(/noConent/);
	await expect(page.locator("#mobileSend")).toBeVisible();

	await switchTo(page, b.username);
	// A's page already showed this name, so this proves only the channel; switchTo's wait on B's
	// username is what proves B's session is up.
	await expect(page.locator("#channelname")).toHaveText("#" + channel.name);
	return {b, channel, composer};
}

// A staged attachment latches the send button on. Switching accounts must not carry the
// attachment, or the latch, into the other account's composer.
test("an attachment staged on one account is not sent by the next account", async ({page}) => {
	const {b, channel} = await stagedOnAThenSwitchedToB(page);
	await expect(page.locator("#pasteimage > *")).toHaveCount(0);

	// What B sends reaches the server as B, with nothing attached.
	await page.locator("#typebox").click();
	await page.keyboard.type("hello from B");
	await page.locator("#mobileSend").tap();
	await expect
		.poll(
			async () => {
				const list = await rest<Message[]>(
					b.token,
					"GET",
					`/channels/${channel.id}/messages?limit=5`,
				);
				return list.map((m) => ({
					content: m.content,
					author: m.author.id,
					attachments: m.attachments.length,
				}));
			},
			{timeout: 30_000},
		)
		.toEqual([{content: "hello from B", author: b.id, attachments: 0}]);
});

test("the next account's send button is as for an empty composer, not latched on", async ({
	page,
}) => {
	const {composer} = await stagedOnAThenSwitchedToB(page);
	await expect(page.locator("#pasteimage > *")).toHaveCount(0);
	await expect(page.locator("#mobileSend")).toBeHidden();
	await expect(composer).toHaveClass(/noConent/);
});
