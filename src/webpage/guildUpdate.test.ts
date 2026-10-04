import {afterEach, describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as guildCommands.test.ts.
await import("./localuser");
const {Guild} = await import("./guild");

const GUILD_ID = "1553128655016763450";
const ROLE_ID = "1553128655016763451";

/** A Guild with only what update() reads and writes, built from READY-shaped properties. */
function guildFixture(lookingguild: boolean) {
	const owner: {headers: object; info: object; guildhtml: Map<string, HTMLElement>; lookingguild?: unknown} = {
		headers: {Authorization: "token"},
		info: {cdn: "http://cdn.test"},
		guildhtml: new Map(),
	};
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: GUILD_ID,
		owner,
		properties: {name: "Old name", owner_id: "100", icon: "abc", features: [], system_channel_id: "1"},
		roleids: new Map([[ROLE_ID, {id: ROLE_ID}]]),
	}) as InstanceType<typeof Guild>;
	if (lookingguild) owner.lookingguild = guild;
	return guild;
}

/** What Spacebar's PATCH /guilds/:id emits: guild.toJSON() with emojis, roles and stickers loaded. */
function guildUpdatePayload() {
	return {
		id: GUILD_ID,
		name: "New name",
		owner_id: "200",
		icon: "abc",
		features: ["COMMUNITY"],
		system_channel_id: "2",
		large: false,
		member_count: 3,
		emojis: [],
		stickers: [],
		roles: [{id: ROLE_ID, name: "@everyone"}],
	} as unknown as Parameters<InstanceType<typeof Guild>["update"]>[0];
}

afterEach(() => document.getElementById("serverName")?.remove());

describe("GUILD_UPDATE", () => {
	it("keeps the role index, so role lookups still resolve after a server edit", () => {
		const guild = guildFixture(false);

		guild.update(guildUpdatePayload());

		expect(guild.roleids.get(ROLE_ID)).toEqual({id: ROLE_ID});
	});

	it("applies the edited properties (name, owner, system channel)", () => {
		const guild = guildFixture(false);

		guild.update(guildUpdatePayload());

		expect(guild.properties.name).toBe("New name");
		expect(guild.properties.owner_id).toBe("200");
		expect(guild.properties.system_channel_id).toBe("2");
		expect(guild.properties.features).toEqual(["COMMUNITY"]);
	});

	it("clears a channel the edit unset (the server omits a null channel id)", () => {
		const guild = guildFixture(false);
		const payload = guildUpdatePayload() as unknown as Record<string, unknown>;
		delete payload.system_channel_id;

		guild.update(payload as unknown as Parameters<typeof guild.update>[0]);

		expect(guild.properties.system_channel_id).toBeNull();
	});

	it("redraws the sidebar icon when only the name changed", () => {
		const guild = guildFixture(false);
		const oldIcon = document.createElement("div");
		document.body.append(oldIcon);
		guild.HTMLicon = oldIcon;

		guild.update(guildUpdatePayload());

		expect(oldIcon.isConnected).toBe(false);
		expect(guild.HTMLicon).not.toBe(oldIcon);
		guild.HTMLicon.remove();
	});

	it("does not copy the payload's collections into properties", () => {
		const guild = guildFixture(false);

		guild.update(guildUpdatePayload());

		expect(guild.properties).not.toHaveProperty("roles");
		expect(guild.properties).not.toHaveProperty("emojis");
		expect(guild.properties).not.toHaveProperty("stickers");
	});

	it("renames the open server's header", () => {
		const header = document.createElement("h2");
		header.id = "serverName";
		header.textContent = "Old name";
		document.body.append(header);
		const guild = guildFixture(true);

		guild.update(guildUpdatePayload());

		expect(header.textContent).toBe("New name");
	});

	it("leaves the header alone when another server is open", () => {
		const header = document.createElement("h2");
		header.id = "serverName";
		header.textContent = "Other server";
		document.body.append(header);
		const guild = guildFixture(false);

		guild.update(guildUpdatePayload());

		expect(header.textContent).toBe("Other server");
	});
});
