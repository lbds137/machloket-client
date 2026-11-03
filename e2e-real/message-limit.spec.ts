import type {Page} from "@playwright/test";
import {DESKTOP, expect, logIn, newAccount, openOnlyGuildChannel, rest, test} from "./fixtures";

test.use(DESKTOP);

// The client reads the server's limit and refuses before sending; these pin that the two agree on
// where the line is and how it counts, since a mismatch either side is a wrong answer to the user.
const LIMIT = 4000;
const TOO_LONG = `Your message is too long: ${LIMIT + 1} characters, and the limit is ${LIMIT}.`;

test("the server counts as the client does: UTF-16 units, untrimmed", async () => {
	const me = await newAccount("count");
	const guild = await rest<{id: string}>(me.token, "POST", "/guilds", {name: "Count"});
	const channels = await rest<{id: string; type: number}[]>(
		me.token,
		"GET",
		`/guilds/${guild.id}/channels`,
	);
	const path = `/channels/${channels.find((c) => c.type === 0)!.id}/messages`;
	const post = (content: string) => rest(me.token, "POST", path, {content});

	await post("😀".repeat(LIMIT / 2));
	await expect(post("😀".repeat(LIMIT / 2) + "x")).rejects.toThrow("BASE_TYPE_MAX_LENGTH");
	await expect(post("x".repeat(LIMIT) + " ")).rejects.toThrow("BASE_TYPE_MAX_LENGTH");

	// An edit is held to the same line.
	const {id} = await rest<{id: string}>(me.token, "POST", path, {content: "short"});
	const patch = (content: string) => rest(me.token, "PATCH", `${path}/${id}`, {content});
	await patch("😀".repeat(LIMIT / 2));
	await expect(patch("😀".repeat(LIMIT / 2) + "x")).rejects.toThrow("BASE_TYPE_MAX_LENGTH");
	await expect(patch("x".repeat(LIMIT) + " ")).rejects.toThrow("BASE_TYPE_MAX_LENGTH");
});

test.describe("a forum post over the limit", () => {
	async function forum() {
		const me = await newAccount("forum");
		const guild = await rest<{id: string}>(me.token, "POST", "/guilds", {name: "Forum"});
		const board = await rest<{id: string; name: string}>(
			me.token,
			"POST",
			`/guilds/${guild.id}/channels`,
			{name: "board", type: 15},
		);
		const threads = async () =>
			(
				await rest<{threads: {name: string}[]}>(
					me.token,
					"GET",
					`/channels/${board.id}/threads/search`,
				)
			).threads.map((t) => t.name);
		return {me, board, threads};
	}

	/** Opens the forum and fills in a too-long post, ready for the second press of Post. */
	async function draftPost(page: Page, boardName: string, content: string) {
		await openOnlyGuildChannel(page, boardName);
		await page.locator(".forumSearch").fill("A title");
		const post = page.locator(".newPostForumButton");
		await post.click();
		const area = page.locator(".forumBody .editMessage");
		await area.fill(content);
		return {post, area};
	}

	test("is held at the client's check, and no thread appears", async ({page}) => {
		const {me, board, threads} = await forum();
		const posts: string[] = [];
		page.on("request", (r) => {
			if (r.method() === "POST" && r.url().endsWith(`/channels/${board.id}/threads`)) posts.push(r.url());
		});
		const limitRead = page.waitForResponse(
			(r) => r.url().endsWith("/policies/instance/config") && r.frame().url().includes("/channels"),
		);
		await logIn(page, me);
		await limitRead;
		const tooLong = "x".repeat(LIMIT + 1);
		const {post, area} = await draftPost(page, board.name, tooLong);

		await post.click();

		await expect(page.getByText(TOO_LONG)).toBeVisible();
		await expect(area).toHaveText(tooLong);
		expect(posts).toEqual([]);
		expect(await threads()).toEqual([]);
	});

	test("with the limit unknown: the server's refusal shows, the text stays, and no thread appears", async ({
		page,
	}) => {
		const {me, board, threads} = await forum();
		// The app's own read only: the login page's discovery may read the same path.
		await page.route("**/policies/instance/config", (route) =>
			route.request().frame().url().includes("/channels") ? route.abort() : route.continue(),
		);
		await logIn(page, me);
		const tooLong = "x".repeat(LIMIT + 1);
		const {post, area} = await draftPost(page, board.name, tooLong);
		const refused = page.waitForResponse((r) => r.url().endsWith(`/channels/${board.id}/threads`));

		await post.click();

		expect((await refused).status()).toBe(400);
		await expect(page.getByText(`Must be ${LIMIT} or fewer in length.`)).toBeVisible();
		await expect(area).toHaveText(tooLong);
		expect(await threads()).toEqual([]);
	});

	test("fits at exactly the limit", async () => {
		const {me, board, threads} = await forum();
		await rest(me.token, "POST", `/channels/${board.id}/threads`, {
			name: "Fits",
			message: {content: "x".repeat(LIMIT)},
		});
		expect(await threads()).toEqual(["Fits"]);
	});
});

test("over the limit: a send and an edit never leave the client, say why, and the text stays", async ({
	page,
}) => {
	const writes: string[] = [];
	page.on("request", (request) => {
		if (["POST", "PATCH"].includes(request.method()) && /\/channels\/\d+\/messages/.test(request.url())) {
			writes.push(request.method());
		}
	});
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
	const limitRead = page.waitForResponse(
		(r) => r.url().endsWith("/policies/instance/config") && r.frame().url().includes("/channels"),
	);
	await logIn(page, me);
	await limitRead;
	await openOnlyGuildChannel(page, channel.name);

	const typebox = page.locator("#typebox");
	const tooLong = "x".repeat(LIMIT + 1);
	await typebox.fill(tooLong);
	await page.keyboard.press("Enter");

	await expect(page.locator("#realbox .sendError")).toHaveText(TOO_LONG);
	await expect(typebox).toHaveText(tooLong);
	expect(writes).toEqual([]);
	expect(await history()).toEqual([]);

	// Exactly the limit goes through.
	const fits = "y".repeat(LIMIT);
	await typebox.fill(fits);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await history()).map((m) => m.content)).toEqual([fits]);
	await expect(page.locator("#realbox .sendError")).toHaveCount(0);

	const sent = page.locator(".messagediv", {hasText: "yyy"}).first();
	await sent.hover();
	await sent.locator(".messageButtons .svg-edit").click();
	const editor = page.locator(".editMessage");
	await editor.fill(tooLong);
	await editor.press("Enter");

	// Only the edit's dialog says it now: the send's notice went with the send that fit.
	await expect(page.getByText(TOO_LONG)).toBeVisible();
	await expect(editor).toHaveText(tooLong);
	expect(writes).toEqual(["POST"]);
	expect((await history()).map((m) => m.content)).toEqual([fits]);
});
