import {expect} from "@playwright/test";
import {DESKTOP, joinOtherServer, loginAndOpenChannel, OTHER_GUILD_ID, test} from "./fixtures";

// A server opened while the viewer's own member in it is still on its way: until the member
// lands every channel reads invisible, so what opens must wait for it.

test.use({...DESKTOP});

test("a server opened before its member arrives opens its channel once the member does", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	// A guild built mid-session isn't registered yet when its constructor resolves the member,
	// so the lookup goes over REST (localuser.ts resolvemember).
	const asked = () =>
		mockInstance.capturedRequests.filter(
			(r) =>
				r.method === "GET" && r.pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
		).length;
	// The member is asked for, and the answer is held: the click lands before it.
	await expect.poll(asked).toBeGreaterThan(0);

	await icon.click();
	mockInstance.releaseMembers();

	await expect(page.locator("#channelname")).toHaveText("#elsewhere");
	await expect(page.locator("#channels button.channelbutton", {hasText: "elsewhere"})).toHaveCount(
		1,
	);
});

test("a server left before its member arrives doesn't pull the user back when it does", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	const memberAnswer = page.waitForResponse((res) =>
		new URL(res.url()).pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
	);
	// Installed before the member is released. Nothing on screen marks the member landing on a
	// guild no longer open, so the wait is the app's own announcement: "guildmemberready"
	// fires as a macrotask after every memberReady awaiter has run — the went-elsewhere
	// decision included — so once it does, what follows can prove nothing moved.
	const memberSettled = page.evaluate(
		(guildId) =>
			new Promise<string>((done) => {
				const listener = (event: Event) => {
					if ((event as CustomEvent<{guildId: string}>).detail.guildId === guildId) {
						document.removeEventListener("guildmemberready", listener);
						done(guildId);
					}
				};
				document.addEventListener("guildmemberready", listener);
			}),
		OTHER_GUILD_ID,
	);

	await icon.click();
	await page.locator("#servers .home").first().click();
	await expect(page).toHaveURL(/\/channels\/@me/);
	mockInstance.releaseMembers();
	await memberAnswer;
	await memberSettled;

	await expect(page).toHaveURL(/\/channels\/@me/);
	await expect(page.locator("#channelname")).not.toHaveText("#elsewhere");
});
