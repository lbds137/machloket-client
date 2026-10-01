import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";
import type {commandJson as commandJsonT} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as pinsPanel.test.ts.
await import("./localuser");
const {Guild} = await import("./guild");

const API_ROOT = "http://guild.test";

/** A Guild with only what getCommandsFetch reads: Guild's info getter resolves through its
 * owner, so the stub provides one (same Object.create pattern as the fixture). */
function guildWithId(id: string) {
	return Object.assign(Object.create(Guild.prototype), {
		id,
		owner: {
			info: {api: API_ROOT},
			headers: {"Content-type": "application/json", Authorization: "token"},
		},
	}) as InstanceType<typeof Guild>;
}

describe("application-command index fetch", () => {
	it("an error body (a non-200 answer) degrades to no commands, not a crash", async () => {
		captureRequests(
			API_ROOT + "/guilds/1554722916606791818/application-command-index",
			() =>
				new Response(JSON.stringify({code: 10013, message: "Unknown Guild"}), {
					status: 404,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const direct = guildWithId("1554722916606791818");

		const {apps, commands} = await direct.getCommandsFetch();

		expect(apps).toEqual([]);
		expect(commands).toEqual([]);
	});

	it('the "@me" guild fetches the user command index, not a guild route', async () => {
		const sent = captureRequests(API_ROOT + "/users/@me/application-command-index", () =>
			new Response(
				JSON.stringify({
					applications: [{id: "300", name: "TzurotProbeB"}],
					application_commands: [
						{id: "900", type: 1, application_id: "300", name: "row9", description: "", dm_permission: true},
					],
				}),
				{headers: {"Content-Type": "application/json"}},
			),
		);
		const direct = guildWithId("@me");

		const {apps, commands} = await direct.getCommandsFetch();

		expect(sent).toHaveLength(1);
		expect(apps).toEqual([{id: "300", name: "TzurotProbeB"}]);
		expect(commands).toHaveLength(1);
		expect((commands[0] as unknown as {name: string}).name).toBe("row9");
	});

	it("a DM context scopes the index to the focused channel's bots", async () => {
		captureRequests(API_ROOT + "/users/@me/application-command-index", () =>
			new Response(JSON.stringify({applications: [], application_commands: []}), {
				headers: {"Content-Type": "application/json"},
			}),
		);
		// captureRequests keys on origin+pathname (queries stripped), so the query is asserted
		// through a delegating fetch wrapper instead.
		const urls: string[] = [];
		const inner = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			urls.push(String(input));
			return inner(input, init);
		}) as typeof fetch;
		const direct = guildWithId("@me");

		try {
			await direct.getCommandsFetch("200");
		} finally {
			globalThis.fetch = inner;
		}

		expect(urls.some((u) => u.includes("channel_id=200"))).toBe(true);
	});

	it("a command registered both globally and per-guild appears once", async () => {
		captureRequests(API_ROOT + "/guilds/1554722916606791818/application-command-index", () =>
			new Response(
				JSON.stringify({
					applications: [{id: "300", name: "Tzurot"}],
					application_commands: [
						{id: "1", type: 1, application_id: "300", name: "random", description: "", dm_permission: true},
						{id: "2", type: 1, application_id: "300", name: "random", description: "", guild_id: "1554722916606791818", dm_permission: true},
						{id: "3", type: 1, application_id: "300", name: "help", description: "", dm_permission: true},
					],
				}),
				{headers: {"Content-Type": "application/json"}},
			),
		);
		const guild = guildWithId("1554722916606791818");

		const commands = (await guild.getCommands()) as unknown as {name: string}[];

		const names = commands.map((c) => c.name);
		expect(names).toEqual(["random", "help"]);
	});

	it("context-menu commands are stored but never offered in the slash popup", async () => {
		captureRequests(API_ROOT + "/guilds/1554722916606791818/application-command-index", () =>
			new Response(
				JSON.stringify({
					applications: [{id: "300", name: "Tzurot"}],
					application_commands: [
						{id: "1", type: 1, application_id: "300", name: "random", description: "", dm_permission: true},
						{id: "2", type: 3, application_id: "300", name: "Inspect Message", description: "", dm_permission: true},
					],
				}),
				{headers: {"Content-Type": "application/json"}},
			),
		);
		const guild = guildWithId("1554722916606791818");

		const slashCommands = await guild.getCommands();

		const names = (slashCommands as unknown as {name: string}[]).map((c) => c.name);
		expect(names).toContain("random");
		expect(names).not.toContain("Inspect Message");
	});
});

describe("command picker rows", () => {
	it("each search-result row shows its bot: the app's icon, the /name, and the app's name", async () => {
		const {Localuser} = await import("./localuser");
		const {Command} = await import("./interactions/commands.js");
		const commandJson = (over: Partial<commandJsonT>): commandJsonT => ({
			id: "1",
			type: 1,
			application_id: "300",
			name: "random",
			description: "",
			dm_permission: true,
			nsfw: false,
			global_popularity_rank: 0,
			version: "1",
			handler: 1,
			...over,
		});
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				getCommands: async () => [
					new Command(commandJson({id: "1", name: "random", application_id: "300"}), localuser),
					new Command(commandJson({id: "2", name: "roll", application_id: "400"}), localuser),
				],
				apps: [
					{id: "300", name: "Tzurot", icon: "ab", description: "", flags: 0},
					{id: "400", name: "Helper", icon: null, description: "", flags: 0},
				],
			},
			channelfocus: undefined,
			info: {cdn: "http://cdn.test"},
		});
		const box = document.createElement("div");
		document.body.append(box);
		try {
			await (localuser as never as {findCommands: (s: string, b: HTMLDivElement, m: unknown) => Promise<void>})
				.findCommands("r", box, {} as never);

			const rows = [...box.children];
			expect(rows).toHaveLength(2);
			const byName = (name: string) =>
				rows.find((r) => r.querySelector(".commandRowName")?.textContent === "/" + name) as HTMLElement;

			// An app with an icon: the CDN avatar precedes the name.
			const random = byName("random");
			const img = random.querySelector("img") as HTMLImageElement;
			expect(img.src.startsWith("http://cdn.test/app-icons/300/ab.png")).toBe(true);
			expect(random.querySelector(".commandRowApp")?.textContent).toBe("Tzurot");

			// An app without an icon: a letter stands in, and the name still names the bot.
			const roll = byName("roll");
			expect(roll.querySelector("img")).toBeNull();
			expect(roll.querySelector(".commandAppIconFallback")?.textContent).toBe("H");
			expect(roll.querySelector(".commandRowApp")?.textContent).toBe("Helper");

			// The name span is exactly "/name" — commit-on-space matches on that text.
			for (const name of ["random", "roll"]) {
				expect(byName(name).querySelector(".commandRowName")?.textContent).toBe("/" + name);
			}
		} finally {
			box.remove();
		}
	});

	it("the browse panel sections commands by bot, with a Frequently Used rail that filters", async () => {
		const {Localuser} = await import("./localuser");
		const {Command} = await import("./interactions/commands.js");
		// Recency keys carry the app id (invocationKey): random is Tzurot's (300), roll
		// Helper's (400).
		localStorage.setItem(
			"commandRecency",
			JSON.stringify({
				"300/random": Date.now() - 5000,
				"400/roll": Date.now(),
			}),
		);
		const commandJson = (over: Partial<commandJsonT>): commandJsonT => ({
			id: "1",
			type: 1,
			application_id: "300",
			name: "random",
			description: "A description",
			dm_permission: true,
			nsfw: false,
			global_popularity_rank: 0,
			version: "1",
			handler: 1,
			...over,
		});
		const started: unknown[] = [];
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				getCommands: async () => [
					new Command(commandJson({id: "1", name: "random", application_id: "300"}), localuser),
					new Command(commandJson({id: "2", name: "roll", application_id: "400"}), localuser),
					new Command(commandJson({id: "3", name: "ask", application_id: "400"}), localuser),
				],
				apps: [
					{id: "300", name: "Tzurot", icon: "ab", description: "Tzurot the bot", flags: 0},
					{id: "400", name: "Helper", icon: null, description: "Helps", flags: 0},
				],
			},
			channelfocus: {startCommand: (c: unknown) => started.push(c)},
			info: {cdn: "http://cdn.test"},
		});
		const box = document.createElement("div");
		document.body.append(box);
		try {
			await (localuser as never as {findCommands: (s: string, b: HTMLDivElement, m: unknown) => Promise<void>})
				.findCommands("", box, {} as never);

			// The rail: Frequently Used first, then the apps alphabetical.
			const rail = [...box.querySelectorAll(".searchRailButton")].map(
				(b) => b.getAttribute("aria-label"),
			);
			expect(rail).toEqual(["Frequently Used", "Helper", "Tzurot"]);

			// The body: recents (most recent first) above one section per app.
			const sections = [...box.querySelectorAll(".searchSectionTitle")].map(
				(t) => t.textContent,
			);
			expect(sections).toEqual(["Frequently Used", "Helper", "Tzurot"]);
			const recentsNames = [
				...box.querySelectorAll(".searchSection")[0].querySelectorAll(".commandRowName"),
			].map((s) => s.textContent);
			expect(recentsNames).toEqual(["/roll", "/random"]);
			// Every row names its bot at the far edge.
			const rollRow = [...box.querySelectorAll(".commandRow")].find((r) =>
				r.querySelector(".commandRowName")?.textContent === "/roll",
			) as HTMLElement;
			expect(rollRow.querySelector(".commandRowApp")?.textContent).toBe("Helper");

			// A rail tab filters the body to that app, titled by the app.
			(box.querySelectorAll(".searchRailButton")[2] as HTMLElement).click();
			expect(
				[...box.querySelectorAll(".commandRowName")].map((s) => s.textContent),
			).toEqual(["/random"]);
			expect(box.querySelector(".searchPanelTitle")?.textContent).toContain("Tzurot");

			// ArrowLeft/Right walk the rail; Enter runs the selected row.
			localuser.keyup(new KeyboardEvent("keyup", {key: "ArrowLeft"}));
			expect(box.querySelector(".searchPanelTitle")?.textContent).toContain("Helper");
			const keydown = new KeyboardEvent("keydown", {key: "ArrowLeft", cancelable: true});
			localuser.keydown(keydown);
			expect(keydown.defaultPrevented).toBe(true);
			localuser.keyup(new KeyboardEvent("keyup", {key: "ArrowDown"}));
			localuser.keyup(new KeyboardEvent("keyup", {key: "Enter"}));
			expect(started).toHaveLength(1);
			// The selection walked DOWN one row: roll ran, not ask.
			expect((started[0] as {name: string}).name).toBe("roll");
			// Picking closed the popup.
			expect(box.childElementCount).toBe(0);
		} finally {
			box.remove();
			localStorage.removeItem("commandRecency");
		}
	});

	it("the picker lists one row per subcommand; picking one pre-selects it", async () => {
		const {Localuser} = await import("./localuser");
		const {Command} = await import("./interactions/commands.js");
		const commandJson = (over: Partial<commandJsonT>): commandJsonT => ({
			id: "1",
			type: 1,
			application_id: "300",
			name: "random",
			description: "A description",
			dm_permission: true,
			nsfw: false,
			global_popularity_rank: 0,
			version: "1",
			handler: 1,
			...over,
		});
		const started: {name?: string; branch?: string}[] = [];
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				getCommands: async () => [
					new Command(
						commandJson({
							id: "1",
							name: "character",
							options: [
								{
									type: 1,
									name: "browse",
									description: "Browse characters",
									options: [{type: 3, name: "query", description: ""}],
								},
								{
									type: 1,
									name: "view",
									description: "View one",
									options: [{type: 3, name: "name", description: "", required: true}],
								},
							],
						}),
						localuser,
					),
					new Command(
						commandJson({id: "2", name: "roll", application_id: "400"}),
						localuser,
					),
				],
				apps: [
					{id: "300", name: "Tzurot", icon: "ab", description: "Tzurot the bot", flags: 0},
					{id: "400", name: "Helper", icon: null, description: "Helps", flags: 0},
				],
			},
			channelfocus: {
				startCommand: (c: {name: string}, branch?: string) =>
					started.push({name: c.name, branch}),
			},
			info: {cdn: "http://cdn.test"},
		});
		const box = document.createElement("div");
		document.body.append(box);
		// Recency keys carry the app id (invocationKey): roll belongs to Helper (400).
		localStorage.setItem(
			"commandRecency",
			JSON.stringify({"400/roll": Date.now()}),
		);
		try {
			await (localuser as never as {findCommands: (s: string, b: HTMLDivElement, m: unknown) => Promise<void>})
				.findCommands("", box, {} as never);

			// Discord's list: one row per runnable path, alphabetical by the full text.
			const sectionOf = (title: string) => {
				const sections = [...box.querySelectorAll(".searchSection")];
				return sections.find((s) =>
					s.querySelector(".searchSectionTitle")?.textContent === title,
				) as HTMLElement;
			};
			const rowsOf = (title: string) =>
				[...sectionOf(title).querySelectorAll(".commandRowName")].map(
					(s) => s.textContent,
				);
			expect(rowsOf("Tzurot")).toEqual(["/character browse", "/character view"]);
			expect(rowsOf("Helper")).toEqual(["/roll"]);

			// Base bold, sub path dimmer, and the SUB's own description.
			const browseRow = [...box.querySelectorAll(".commandRow")].find((r) =>
				r.querySelector(".commandRowName")?.textContent === "/character browse",
			) as HTMLElement;
			expect(browseRow.querySelector(".commandRowBase")?.textContent).toBe("/character");
			expect(browseRow.querySelector(".commandRowSubs")?.textContent).toBe(" browse");
			expect(browseRow.querySelector(".commandRowDesc")?.textContent).toBe("Browse characters");

			browseRow.click();
			expect(started).toEqual([{name: "character", branch: "browse"}]);
		} finally {
			box.remove();
			localStorage.removeItem("commandRecency");
		}
	});

	it("mention and channel popups put the BEST match on top, selected", async () => {
		const {Localuser} = await import("./localuser");
		const {User} = await import("./user.js");
		const member = (name: string, score: number) => {
			const user = Object.assign(Object.create(User.prototype), {
				compare: () => score,
				getpfpsrc: () => "",
			});
			Object.defineProperty(user, "name", {value: name, writable: true});
			return user;
		};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				id: "100",
				members: [member("joel", 1), member("ajo", 2)],
				roles: [],
				member_count: 2,
				members_size: 2,
			},
			channelfocus: undefined,
		});
		const box = document.createElement("div");
		document.body.append(box);
		try {
			localuser.MDFineMentionGen("jo", "@jo", box, {} as never);
			const rows = [...box.children].map((c) => c.textContent);
			expect(rows[0]).toBe("@ajo"); // best match renders at the top…
			expect(box.querySelector("span.selected")?.textContent).toBe("@ajo"); // …selected
		} finally {
			box.remove();
		}

		const chanUser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				channels: [
					{name: "general", visible: true, similar: () => 1},
					{name: "joys", visible: true, similar: () => 2},
				],
			},
		});
		const box2 = document.createElement("div");
		document.body.append(box2);
		try {
			chanUser.MDFindChannel("j", "#j", box2, {} as never);
			const rows = [...box2.children].map((c) => c.textContent);
			expect(rows[0]).toBe("# joys");
			expect(box2.querySelector("span.selected")?.textContent).toBe("# joys");
		} finally {
			box2.remove();
		}
	});

	it("a command-less context renders an empty popup that doesn't eat Enter", async () => {
		const {Localuser} = await import("./localuser");
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			lookingguild: {
				getCommands: async () => [],
				apps: [],
			},
			channelfocus: undefined,
			info: {cdn: "http://cdn.test"},
		});
		const box = document.createElement("div");
		document.body.append(box);
		try {
			await (localuser as never as {findCommands: (s: string, b: HTMLDivElement, m: unknown) => Promise<void>})
				.findCommands("", box, {} as never);

			expect(box.childElementCount).toBe(0);
			// No handlers stuck holding the keyboard: Enter falls through to sending.
			expect(localuser.keyup(new KeyboardEvent("keyup", {key: "Enter"}))).toBe(false);
		} finally {
			box.remove();
		}
	});
});
