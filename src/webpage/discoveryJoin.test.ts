import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

const {Localuser} = await import("./localuser");
const {Discovery} = await import("./discovery");

const API = "http://discover.test/api/v9";

afterEach(() => document.querySelectorAll("dialog, .flexttb").forEach((e) => e.remove()));

describe("joining a server from discovery", () => {
	it("a refused join says why and stops, instead of polling forever", async () => {
		captureRequests(API + "/guilds/g9/members/@me", () =>
			Response.json({code: 40007, message: "You are banned from this guild"}, {status: 403}),
		);
		const discovery = Object.assign(Object.create(Discovery.prototype), {
			owner: {info: {api: API}, headers: {}, localuser: {guildids: new Map()}},
		}) as InstanceType<typeof Discovery>;

		const outcome = await Promise.race([
			discovery.join({id: "g9"} as never).then(() => "returned"),
			new Promise((res) => setTimeout(() => res("still polling"), 1000)),
		]);

		expect(outcome).toBe("returned");
		expect(document.body.textContent).toContain("You are banned from this guild");
	});

	const limited = (message?: string) =>
		Response.json({...(message ? {message} : {}), retry_after: 0.01}, {status: 429});

	// RED: at HEAD the 429 is a refusal, so the guild is never loaded and the PUT happens once.
	it("a 429 waits its window, asks again once, and the join goes through", async () => {
		let calls = 0;
		const asked = captureRequests(API + "/guilds/g9/members/@me", () =>
			calls++ === 0 ? limited() : new Response(null, {status: 204}),
		);
		const joined = {loadGuild: vi.fn(), loadChannel: vi.fn(async () => {})};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			guildids: new Map([["g9", joined]]),
			loadGuild: vi.fn(() => {
				joined.loadGuild();
				return joined;
			}),
		});
		const discovery = Object.assign(Object.create(Discovery.prototype), {
			owner: {info: {api: API}, headers: {}, localuser},
		}) as InstanceType<typeof Discovery>;

		await discovery.join({id: "g9"} as never);

		expect(asked).toHaveLength(2);
		expect(joined.loadGuild).toHaveBeenCalledOnce();
		expect(document.body.textContent).not.toContain("That didn't go through");
	});

	it("going elsewhere before the joined guild arrives does not pull the user into it when it arrives", async () => {
		const asked = captureRequests(
			API + "/guilds/g9/members/@me",
			() => new Response(null, {status: 204}),
		);
		const joined = {
			id: "g9",
			loadGuild: vi.fn(() => localuser.loadGuild("g9")),
			loadChannel: vi.fn(async () => {}),
		};
		const other = {id: "g2", loadChannel: vi.fn(async () => {})};
		const localuser = Object.assign(Object.create(Localuser.prototype), {
			guildids: new Map([["g2", other]]),
		}) as InstanceType<typeof Localuser>;
		const loadGuild = vi
			.spyOn(localuser, "loadGuild")
			.mockImplementationOnce(Object.getPrototypeOf(localuser).loadGuild.bind(localuser))
			.mockImplementation(() => undefined);
		const discovery = Object.assign(Object.create(Discovery.prototype), {
			owner: {info: {api: API}, headers: {}, localuser},
		}) as InstanceType<typeof Discovery>;

		const joining = discovery.join({id: "g9"} as never);
		await vi.waitFor(() => expect(asked).toHaveLength(1));
		// The join has registered its wait for g9 (not a fixed sleep: a slow PUT would
		// otherwise let loadGuild("g2") run first).
		await vi.waitFor(() =>
			expect((localuser as unknown as {joinedGuildId?: string}).joinedGuildId).toBe("g9"),
		);
		try {
			localuser.loadGuild("g2");
		} catch {
			// the page-less body throws past the joinedGuildId clear at the entry
		}
		localuser.guildids.set("g9", joined as never);
		localuser.guildArrived("g9");
		await joining;

		expect(loadGuild).not.toHaveBeenCalledWith("g9");
		expect(joined.loadChannel).not.toHaveBeenCalled();
	});

	// RED: at HEAD the dialog already shows the message; the PUT count is what fails.
	it("a second 429 says why, with the server's message", async () => {
		const asked = captureRequests(API + "/guilds/g9/members/@me", () => limited("Slow down"));
		const discovery = Object.assign(Object.create(Discovery.prototype), {
			owner: {info: {api: API}, headers: {}, localuser: {guildids: new Map()}},
		}) as InstanceType<typeof Discovery>;

		await discovery.join({id: "g9"} as never);

		expect(asked).toHaveLength(2);
		expect(document.body.textContent).toContain("Slow down");
	});
});
