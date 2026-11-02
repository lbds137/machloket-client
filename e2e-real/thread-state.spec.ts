import type {Locator, Page} from "@playwright/test";
import {DESKTOP, expect, logIn, newAccount, rest, test, type RealAccount} from "./fixtures";

// What an archived or locked thread still lets a person do, against the server's own rules:
// archived refuses edits and new reactions, but takes a send and the removal of your own reaction;
// locked refuses sends and edits without MANAGE_THREADS, and refuses no reaction.

test.use(DESKTOP);

const THUMBS = encodeURIComponent("👍");
const FIRE = encodeURIComponent("🔥");

type World = {owner: RealAccount; member: RealAccount; guildId: string; threadId: string};

/** A thread the member has joined, holding a message of each, with 👍 from its author and 🔥 from
 * the owner on the member's. */
async function setUp(): Promise<World & {memberMessage: string; ownerMessage: string}> {
	const owner = await newAccount("threadowner");
	const member = await newAccount("threadmember");
	const guild = await rest<{id: string}>(owner.token, "POST", "/guilds", {name: "Thread state"});
	const channels = await rest<{id: string; type: number}[]>(
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
	const thread = await rest<{id: string}>(owner.token, "POST", `/channels/${channel.id}/threads`, {
		name: "state-thread",
		type: 11,
		auto_archive_duration: 1440,
	});
	await rest(member.token, "PUT", `/channels/${thread.id}/thread-members/@me`);
	const send = (token: string, content: string) =>
		rest<{id: string}>(token, "POST", `/channels/${thread.id}/messages`, {content});
	const {id: memberMessage} = await send(member.token, "from the member");
	const {id: ownerMessage} = await send(owner.token, "from the owner");
	const react = (token: string, messageId: string, emoji: string) =>
		rest(token, "PUT", `/channels/${thread.id}/messages/${messageId}/reactions/${emoji}/@me`);
	await react(member.token, memberMessage, THUMBS);
	await react(owner.token, memberMessage, FIRE);
	return {owner, member, guildId: guild.id, threadId: thread.id, memberMessage, ownerMessage};
}

async function openThread(page: Page, who: RealAccount, world: World): Promise<void> {
	await logIn(page, who);
	await page.goto(`/channels/${world.guildId}/${world.threadId}`);
	await expect(page.locator("#channelname")).toContainText("state-thread");
}

const row = (page: Page, text: string) => page.locator(".messagediv", {hasText: text}).first();
const pill = (message: Locator, emoji: string) => message.locator(".reaction", {hasText: emoji});

/** What the message's hover bar offers. The bar is built on mouseenter, so the pointer leaves
 * first: one still over the row would read the bar drawn before the thread changed. */
async function hoverBar(
	message: Locator,
): Promise<{edit: boolean; react: boolean; reply: boolean}> {
	await message.page().mouse.move(0, 0);
	await message.hover();
	const bar = message.locator(".messageButtons");
	await expect(bar).toBeVisible();
	return {
		edit: (await bar.locator(".svg-edit").count()) > 0,
		react: (await bar.locator(".svg-emoji").count()) > 0,
		reply: (await bar.locator(".svg-reply").count()) > 0,
	};
}

async function menuLabels(page: Page, message: Locator): Promise<string[]> {
	await message.click({button: "right"});
	const menu = page.locator(".contextmenu");
	await expect(menu).toBeVisible();
	const labels = await menu.locator("button").allTextContents();
	await page.locator("#channelname").click();
	await expect(menu).toHaveCount(0);
	return labels.map((label) => label.trim());
}

/** Up-arrow in an empty composer edits your last message, where that's allowed. */
async function upArrowOpensEditor(page: Page): Promise<boolean> {
	await page.locator("#typebox").click();
	await page.keyboard.press("ArrowUp");
	const editor = page.locator(".editMessage");
	const opened = await editor
		.waitFor({state: "visible", timeout: 1500})
		.then(() => true)
		.catch(() => false);
	if (opened) {
		await editor.press("Escape");
		await expect(editor).toHaveCount(0);
	}
	return opened;
}

const composerOpen = (page: Page) =>
	page.locator("#typebox").evaluate((box: HTMLElement) => box.contentEditable !== "false");

test("archived: no edit or new reaction, your own reaction comes off, a send reopens it", async ({
	page,
}) => {
	const world = await setUp();
	await openThread(page, world.member, world);
	const message = row(page, "from the member");
	await expect(pill(message, "🔥")).toContainText("1");

	// The open thread offers it all, so the absences below aren't a page that failed to draw.
	expect(await hoverBar(message)).toEqual({edit: true, react: true, reply: true});
	expect(await upArrowOpensEditor(page)).toBe(true);

	await rest(world.owner.token, "PATCH", `/channels/${world.threadId}`, {archived: true});

	await expect.poll(async () => (await hoverBar(message)).edit).toBe(false);
	expect(await hoverBar(message)).toEqual({edit: false, react: false, reply: true});
	const labels = await menuLabels(page, message);
	expect(labels).toContain("Reply");
	expect(labels).not.toContain("Edit message");
	expect(labels).not.toContain("Add reaction");
	expect(await upArrowOpensEditor(page)).toBe(false);
	expect(await composerOpen(page)).toBe(true);

	// Someone else's pill sends nothing: the server would refuse the PUT.
	const puts: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "PUT" && request.url().includes("/reactions/")) {
			puts.push(request.url());
		}
	});
	await expect(pill(message, "🔥")).toHaveClass(/reactionClosed/);
	await pill(message, "🔥").click();
	await expect(pill(message, "🔥")).toContainText("1");

	// Your own comes off: the server's DELETE has no archived rule. Its request is what the no-PUT
	// check above stands on: a click that was going to send has sent by now.
	const removal = page.waitForRequest(
		(request) => request.method() === "DELETE" && request.url().includes("/reactions/"),
	);
	await pill(message, "👍").click();
	await removal;
	expect(puts).toEqual([]);
	await expect(pill(message, "👍")).toHaveCount(0);

	// A send unarchives, for the sender too.
	await page.locator("#typebox").click();
	await page.keyboard.type("waking it");
	await page.keyboard.press("Enter");
	await expect(row(page, "waking it")).toBeVisible();
	await expect.poll(async () => (await hoverBar(message)).edit).toBe(true);
	await expect(pill(message, "🔥")).not.toHaveClass(/reactionClosed/);
});

test("locked: without MANAGE_THREADS no send, edit or reply, but reactions stand", async ({
	page,
}) => {
	const world = await setUp();
	await openThread(page, world.member, world);
	const message = row(page, "from the member");
	await expect(pill(message, "🔥")).toContainText("1");
	expect(await composerOpen(page)).toBe(true);
	await message.hover();
	await message.locator(".messageButtons .svg-reply").click();
	await expect(page.locator("#replybox")).toContainText("Replying to");

	await rest(world.owner.token, "PATCH", `/channels/${world.threadId}`, {locked: true});

	await expect.poll(() => composerOpen(page)).toBe(false);
	await expect(page.locator("#replybox")).toBeEmpty();
	expect(await hoverBar(message)).toEqual({edit: false, react: true, reply: false});
	const labels = await menuLabels(page, message);
	expect(labels).toContain("Add reaction");
	expect(labels).not.toContain("Reply");
	expect(labels).not.toContain("Edit message");

	await pill(message, "🔥").click();
	await expect(pill(message, "🔥")).toContainText("2");

	// Unlocking gives it all back without a reload.
	await rest(world.owner.token, "PATCH", `/channels/${world.threadId}`, {locked: false});
	await expect.poll(() => composerOpen(page)).toBe(true);
	expect(await hoverBar(message)).toEqual({edit: true, react: true, reply: true});
});

test("locked: a thread manager still sends and edits, and archived stops the edit", async ({
	page,
}) => {
	const world = await setUp();
	// A role holding the one bit, not the guild's owner, whom the admin path would wave through.
	const role = await rest<{id: string}>(
		world.owner.token,
		"POST",
		`/guilds/${world.guildId}/roles`,
		{
			name: "threads",
			permissions: String(1n << 34n),
		},
	);
	await rest(
		world.owner.token,
		"PUT",
		`/guilds/${world.guildId}/members/${world.member.id}/roles/${role.id}`,
	);
	await rest(world.owner.token, "PATCH", `/channels/${world.threadId}`, {locked: true});
	await openThread(page, world.member, world);
	const message = row(page, "from the member");

	await expect(message).toBeVisible();
	expect(await composerOpen(page)).toBe(true);
	expect(await hoverBar(message)).toEqual({edit: true, react: true, reply: true});

	await message.hover();
	await message.locator(".messageButtons .svg-edit").click();
	const editor = page.locator(".editMessage");
	await expect(editor).toBeVisible();
	await editor.press("End");
	await page.keyboard.type(" edited");
	await page.keyboard.press("Enter");
	await expect(row(page, "from the member edited")).toBeVisible();

	await rest(world.owner.token, "PATCH", `/channels/${world.threadId}`, {archived: true});
	await expect
		.poll(async () => (await hoverBar(row(page, "from the member edited"))).edit)
		.toBe(false);
	expect(await composerOpen(page)).toBe(true);
});
