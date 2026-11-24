import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Member} = await import("./member");

describe("opening a channel as an admin", () => {
	it("writes nothing to the server (reading whether you can message is pure)", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const channel = Object.assign(Object.create(Channel.prototype), {
			permission_overwritesar: [],
			owner: {roles: [{name: "@everyone", id: "g1"}]},
			hasPermission: () => true,
			isThread: () => false,
		}) as InstanceType<typeof Channel>;

		try {
			void channel.canMessage;
			void channel.canMessage;

			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});

describe("reading whether a member can message", () => {
	it("walks roles and overwrites without writing to the server", async () => {
		const {Permissions} = await import("./permissions");
		const bits = (...names: string[]) =>
			names.reduce(
				(total, name) => total | (1n << BigInt(Permissions.permisions.indexOf(name as never))),
				0n,
			) + "";
		const overwrite = (allow: string[], deny: string[]) =>
			new Permissions(bits(...allow), bits(...deny));
		const member = {
			id: "u1",
			isAdmin: () => false,
			commuicationDisabledLeft: () => 0,
			roles: [
				{id: "mod", permissions: new Permissions(bits())},
				{id: "helper", permissions: new Permissions(bits())},
				{id: "g1", permissions: new Permissions(bits("SEND_MESSAGES"))},
			],
		};
		// Every step of the walk decides something: @everyone denies sending, Mod denies it too,
		// Helper allows it (an allow on any role wins), and only the member's own overwrite lets
		// them view the channel at all.
		const text = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			type: 0,
			owner: {id: "g1", member},
			permission_overwrites: new Map([
				["g1", overwrite([], ["SEND_MESSAGES"])],
				["mod", overwrite([], ["SEND_MESSAGES"])],
				["helper", overwrite(["SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS"], [])],
				["u1", overwrite(["VIEW_CHANNEL"], [])],
			]),
		}) as InstanceType<typeof Channel>;
		// An open thread under it asks the parent for SEND_MESSAGES_IN_THREADS.
		const open = Object.assign(Object.create(Channel.prototype), {
			id: "t0",
			type: 11,
			owner: {id: "g1", member},
			parent: text,
			threadData: {locked: false},
			permission_overwrites: new Map(),
		}) as InstanceType<typeof Channel>;
		// A locked thread under it: the lock check asks the parent for MANAGE_THREADS.
		const thread = Object.assign(Object.create(Channel.prototype), {
			id: "t1",
			type: 11,
			owner: {id: "g1", member},
			parent: text,
			threadData: {locked: true},
			permission_overwrites: new Map(),
		}) as InstanceType<typeof Channel>;
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		try {
			expect(text.canMessage).toBe(true);
			expect(text.canMessage).toBe(true);
			expect(open.canMessage).toBe(true);
			expect(thread.canMessage).toBe(false);

			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
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
		const sent = captureRequests(
			API + "/guilds/g1/members/u1",
			() => new Response(null, {status: 204}),
		);
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
