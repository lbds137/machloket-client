import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Member} = await import("./member");

describe("opening a channel as an admin", () => {
	it("writes nothing to the server (reading whether you can message is pure)", () => {
		const addRoleToPerms = vi.fn();
		const channel = Object.assign(Object.create(Channel.prototype), {
			permission_overwritesar: [],
			owner: {roles: [{name: "@everyone", id: "g1"}]},
			hasPermission: () => true,
			isThread: () => false,
			addRoleToPerms,
		}) as InstanceType<typeof Channel>;

		void channel.canMessage;
		void channel.canMessage;

		expect(addRoleToPerms).not.toHaveBeenCalled();
	});
});

describe("a channel's permission list", () => {
	it("saving the @everyone row it offered replaces that row instead of adding a second", async () => {
		const {RoleList} = await import("./role");
		const {Permissions} = await import("./permissions");
		const everyone = {id: "g1", name: "@everyone"};
		const list = Object.assign(Object.create(RoleList.prototype), {
			permissions: [[everyone, new Permissions("0", "0")]],
			redoButtons: () => {},
		}) as {permissions: [unknown, unknown][]};
		const saved = new Permissions("2048", "0");

		(list as unknown as {croleUpdate: (r: unknown, p: unknown, a: boolean) => void}).croleUpdate(
			{...everyone},
			saved,
			true,
		);

		expect(list.permissions).toHaveLength(1);
		expect(list.permissions[0][1]).toBe(saved);
	});
});

describe("a moderation reason", () => {
	it("in Hebrew still lets the kick through (the header is URI-encoded)", async () => {
		const API = "http://mod.test/api/v9";
		const sent = captureRequests(API + "/guilds/g1/members/u1", () => new Response(null, {status: 204}));
		const headersSeen: Headers[] = [];
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
			headersSeen.push(new Headers(init?.headers));
			return realFetch(input, init);
		});
		const member = Object.assign(Object.create(Member.prototype), {
			id: "u1",
			// `guild` and `info` read through the owner.
			owner: {id: "g1", info: {api: API}, headers: {Authorization: "t"}},
		}) as {kickAPI: (reason: string) => void};

		member.kickAPI("ספאם");

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(headersSeen[0].get("x-audit-log-reason")).toBe(encodeURIComponent("ספאם"));
		vi.restoreAllMocks();
	});
});
