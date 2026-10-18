import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
const {captureRequests} = await import("./test/setup");
await I18n.done;

const API = "http://users.test/api/v9";
// A snowflake from after Discord's epoch, so resolve asks the server.
const ID = "1553128655016763450";

function session() {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "http://users.test/cdn"},
		headers: {},
		userMap: new Map(),
		userResMap: new Map(),
		guilds: [],
	}) as InstanceType<typeof Localuser>;
}

const reply = (status: number, body: unknown) => () =>
	new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});

it("a user the server doesn't know (Discord's 10013) resolves to the not-found user", async () => {
	captureRequests(`${API}/users/${ID}/profile`, reply(404, {code: 10013, message: "Unknown User"}));

	await expect(session().getUser(ID)).resolves.toMatchObject({
		username: I18n.friends.notfound(),
	});
});

it("a failed lookup isn't remembered: the next one asks again", async () => {
	const lu = session();
	captureRequests(`${API}/users/${ID}/profile`, reply(500, {message: "Internal Server Error"}));
	await lu.getUser(ID).catch(() => {});

	captureRequests(
		`${API}/users/${ID}/profile`,
		reply(200, {
			user: {id: ID, username: "ann", discriminator: "0", avatar: null, public_flags: 0},
		}),
	);

	await expect(lu.getUser(ID)).resolves.toMatchObject({username: "ann"});
});
