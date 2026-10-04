import {afterEach, describe, expect, it} from "vitest";

await import("./localuser");
const {Specialuser} = await import("./utils/utils");

function account(email: string) {
	const base = "http://acct.test";
	return {
		serverurls: {api: base + "/api/v9", cdn: base, gateway: "ws://acct.test", wellknown: base},
		email,
		token: "t-" + email,
		loggedin: true,
	};
}

const saved = localStorage.getItem("userinfos");
afterEach(() => {
	if (saved === null) localStorage.removeItem("userinfos");
	else localStorage.setItem("userinfos", saved);
});

describe("logging out of one of two accounts", () => {
	it("switches to the remaining account instead of none", () => {
		const a = new Specialuser(account("a@x"));
		const b = new Specialuser(account("b@x"));
		localStorage.setItem(
			"userinfos",
			JSON.stringify({users: {[a.uid]: a.toJSON(), [b.uid]: b.toJSON()}, currentuser: a.uid}),
		);

		a.remove();

		expect(JSON.parse(localStorage.getItem("userinfos")!).currentuser).toBe(b.uid);
	});
});
