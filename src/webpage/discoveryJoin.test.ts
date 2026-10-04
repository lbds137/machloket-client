import {afterEach, describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

await import("./localuser");
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
});
