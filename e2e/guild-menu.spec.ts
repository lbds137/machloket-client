import {expect, type Page} from "@playwright/test";
import {
	DESKTOP,
	MOCK_GUILD_ID,
	MOCK_INSTANCE_ORIGIN,
	expectRequests,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// The guild icon's right-click menu (src/webpage/guild.ts setupcontextmenu): the Mute and
// Unmute rows swap with the guild's state, and Copy server info writes the real clipboard.
test.use(DESKTOP);

test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

/** The open guild's pillar entry. */
const openGuildIcon = (page: Page) => page.locator("#servers .servernoti.serveropen");
/** Every pillar entry showing as muted (Guild.showMuteState toggles the class). */
const guildPillar = (page: Page) => page.locator("#servers .servernoti.muted");
const menuRow = (page: Page, name: string) =>
	page.locator(".contextmenu").getByRole("button", {name, exact: true});

async function openGuildMenu(page: Page) {
	// A previous menu's removal is a later task (removeAni: the close animation runs
	// first, detached after it or a 500 ms fallback) - the fresh right-click would stack
	// the new menu under the detaching one and trip strict mode.
	await expect(page.locator(".contextmenu")).toHaveCount(0);
	await openGuildIcon(page).locator("img.servericon").click({button: "right"});
	await expect(page.locator(".contextmenu")).toBeVisible();
}

test("Mute asks for a duration, mutes the guild icon; Unmute undoes it", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	await expect(guildPillar(page)).toHaveCount(0);

	await openGuildMenu(page);
	await expect(menuRow(page, "Mute server")).toBeVisible();
	await expect(menuRow(page, "Unmute server")).toHaveCount(0);
	await menuRow(page, "Mute server").click();

	// The duration dialog: the default (30 minutes) is fine, Submit sends it.
	const submit = page.getByRole("button", {name: "Submit", exact: true});
	await expect(submit).toBeVisible();
	await submit.click();

	await expect(guildPillar(page)).toHaveCount(1);
	// The open guild's icon is the one that dims, and it really does look dimmed.
	await expect(openGuildIcon(page)).toHaveClass(/\bmuted\b/);
	const opacity = () => openGuildIcon(page).evaluate((el) => Number(getComputedStyle(el).opacity));
	await expect.poll(opacity).toBeLessThan(1);
	const isSettings = (req: {method: string; pathname: string}) =>
		req.method === "PATCH" && req.pathname === `/api/v9/users/@me/guilds/${MOCK_GUILD_ID}/settings`;
	const [mute] = await expectRequests(mockInstance, isSettings, 1);
	expect(mute.body).toMatchObject({muted: true, mute_config: {selected_time_window: 1800}});

	await openGuildMenu(page);
	await expect(menuRow(page, "Unmute server")).toBeVisible();
	await expect(menuRow(page, "Mute server")).toHaveCount(0);
	await menuRow(page, "Unmute server").click();

	await expect(guildPillar(page)).toHaveCount(0);
	await expect(openGuildIcon(page)).toHaveCSS("opacity", "1");
	const sent = await expectRequests(mockInstance, isSettings, 2);
	expect(sent[1].body).toMatchObject({muted: false});

	await openGuildMenu(page);
	await expect(menuRow(page, "Mute server")).toBeVisible();
	await expect(menuRow(page, "Unmute server")).toHaveCount(0);
});

test("Copy server info puts the guild's name and id on the clipboard", async ({page, context}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: MOCK_INSTANCE_ORIGIN,
	});
	await loginAndOpenChannel(page);

	await openGuildMenu(page);
	await menuRow(page, "Copy server info").click();

	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(`Mock Guild (${MOCK_GUILD_ID})`);
});
