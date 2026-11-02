import {expect, type Page} from "@playwright/test";
import {DESKTOP, MOCK_FORUM_CHANNEL, loginAndOpenChannel, test} from "./fixtures";

// The instance's limit, read from its config: over it, nothing goes to the server and the text
// stays. Fits or no limit known: the server decides (composer-refusal.spec.ts, which has no limit).
const LIMIT = 10;
test.use({
	...DESKTOP,
	mockInstanceOptions: {
		extraChannels: [MOCK_FORUM_CHANNEL],
		policiesConfig: {limits_message_maxCharacters: LIMIT},
	},
});

const tooLongText = (length: number) =>
	`Your message is too long: ${length} characters, and the limit is ${LIMIT}.`;

/** Logs in, opens the channel and waits for the app's own read of the limit (the login page reads
 * the same route). Returns the POSTs to `path` seen from then on. */
async function openWithLimit(page: Page, path = "/messages") {
	const posts: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().endsWith(path)) posts.push(request.url());
	});
	let appRead = false;
	page.on("response", (response) => {
		if (
			response.url().endsWith("/policies/instance/config") &&
			response.frame().url().includes("/channels")
		) {
			appRead = true;
		}
	});
	await loginAndOpenChannel(page);
	await expect.poll(() => appRead).toBe(true);
	return posts;
}

test("over the limit: nothing is sent, and the text and reply target stay", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	const posts = await openWithLimit(page);

	const message = page.locator(".messagediv").first();
	await message.hover();
	await message.locator(".messageButtons .svg-reply").click();
	const replybar = page.locator("#replybox");
	await expect(replybar).not.toBeEmpty();

	const typebox = page.locator("#typebox");
	const tooLong = "x".repeat(LIMIT + 1);
	await typebox.fill(tooLong);
	await page.keyboard.press("Enter");

	await expect(page.locator("#realbox .sendError")).toHaveText(tooLongText(LIMIT + 1));
	await expect(typebox).toHaveText(tooLong);
	await expect(replybar).not.toBeEmpty();
	expect(posts).toEqual([]);

	// Cut down to the limit, the same send goes.
	await typebox.fill("y".repeat(LIMIT));
	await page.keyboard.press("Enter");
	await expect.poll(() => posts.length).toBe(1);
	await expect(page.locator("#realbox .sendError")).toHaveCount(0);
	await expect(typebox).toHaveText("");
});

test("a forum post over the limit isn't sent and says why", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	const posts = await openWithLimit(page, "/threads");

	await page.locator("#channels button.channelbutton", {hasText: MOCK_FORUM_CHANNEL.name}).click();
	await page.locator(".forumSearch").fill("A title");
	const post = page.locator(".newPostForumButton");
	await post.click();
	const tooLong = "x".repeat(LIMIT + 1);
	const area = page.locator(".forumBody .editMessage");
	await area.fill(tooLong);
	await post.click();

	await expect(page.getByText(tooLongText(LIMIT + 1))).toBeVisible();
	await expect(area).toHaveText(tooLong);
	expect(posts).toEqual([]);
});
