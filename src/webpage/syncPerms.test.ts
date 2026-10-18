import {afterEach, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://sync.test/api/v9";

afterEach(() => {
	document.body.replaceChildren();
});

/** Category k1 with two text channels, c1 and c2. */
function category() {
	const child = (id: string) => ({id, isThread: () => false});
	return Object.assign(Object.create(Channel.prototype), {
		id: "k1",
		owner: {info: {api: API}, roleids: new Map()},
		headers: {},
		children: [child("c1"), child("c2")],
		permission_overwrites: new Map(),
	}) as InstanceType<typeof Channel>;
}

it("a sync the server refuses for one channel says why, not that it synced", async () => {
	captureRequests(API + "/channels/c1", () => Response.json({}));
	captureRequests(API + "/channels/c2", () =>
		Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);

	await category().syncPermsToChildren();

	expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions"));
	expect(document.body.textContent).not.toContain(I18n.channel.syncPermsSuccess());
});

it("a sync that never reached the server says it's offline", async () => {
	captureRequests(API + "/channels/c1", () => Response.json({}));
	captureRequests(API + "/channels/c2", () => Promise.reject(new TypeError("Failed to fetch")));

	await category().syncPermsToChildren();

	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("a sync every channel took says it synced", async () => {
	const c1 = captureRequests(API + "/channels/c1", () => Response.json({}));
	const c2 = captureRequests(API + "/channels/c2", () => Response.json({}));

	await category().syncPermsToChildren();

	expect(document.body.textContent).toContain(I18n.channel.syncPermsSuccess());
	expect([c1, c2]).toEqual([[{permission_overwrites: []}], [{permission_overwrites: []}]]);
});

it("a sync sends the category's role and member overwrites, and leaves threads alone", async () => {
	const {Permissions} = await import("./permissions");
	const forum = category();
	forum.permission_overwrites = new Map([
		["r1", new Permissions("1024", "2048")],
		["u1", new Permissions("0", "1024")],
	]);
	(forum.guild.roleids as Map<string, unknown>).set("r1", {});
	forum.children.push(Object.assign(Object.create(Channel.prototype), {id: "t1", type: 11}));
	const c1 = captureRequests(API + "/channels/c1", () => Response.json({}));
	captureRequests(API + "/channels/c2", () => Response.json({}));
	const thread = captureRequests(API + "/channels/t1", () => Response.json({}));

	await forum.syncPermsToChildren();

	expect(c1).toEqual([
		{
			permission_overwrites: [
				{id: "r1", type: 0, allow: "1024", deny: "2048"},
				{id: "u1", type: 1, allow: "0", deny: "1024"},
			],
		},
	]);
	expect(thread).toEqual([]);
});
