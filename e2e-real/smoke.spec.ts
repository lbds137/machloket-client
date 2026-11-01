import {
	expect,
	gatewayOrigin,
	logIn,
	newAccount,
	openOnlyGuildChannel,
	rest,
	test,
} from "./fixtures";

// The tier's own proof: real login, real REST, real gateway, two real accounts.
test("a sent message reaches the server, and another member's reaches the page", async ({
	page,
	gatewaySockets,
}) => {
	const owner = await newAccount("owner");
	const member = await newAccount("member");
	const guild = await rest(owner.token, "POST", "/guilds", {name: "Real guild"});
	const channels = await rest<{id: string; type: number; name: string}[]>(
		owner.token,
		"GET",
		`/guilds/${guild.id}/channels`,
	);
	const channel = channels.find((c) => c.type === 0)!;
	const invite = await rest(owner.token, "POST", `/channels/${channel.id}/invites`, {});
	await rest(member.token, "POST", `/invites/${invite.code}`, {});

	await logIn(page, owner);
	await openOnlyGuildChannel(page, channel.name);

	await page.locator("#typebox").click();
	await page.keyboard.type("from the page");
	await page.locator("#mobileSend").tap();
	// The first send on a virgin database can cost several seconds.
	await expect
		.poll(
			async () => {
				const list = await rest<{content: string}[]>(
					member.token,
					"GET",
					`/channels/${channel.id}/messages?limit=5`,
				);
				return list.map((m) => m.content);
			},
			{timeout: 30_000},
		)
		.toContain("from the page");

	await rest(member.token, "POST", `/channels/${channel.id}/messages`, {
		content: "from the server",
	});
	await expect(page.getByText("from the server", {exact: true})).toBeVisible({timeout: 30_000});
	expect(gatewaySockets.some((url) => url.startsWith(gatewayOrigin()))).toBe(true);
});
