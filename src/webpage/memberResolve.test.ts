import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Member} = await import("./member");

/** A guild whose member lookup answers with `answer` (the REST shape has no top-level id). */
function guildAnswering(answer: () => Promise<unknown>) {
	const localuser = {
		userMap: new Map(),
		guilds: [] as unknown[],
		presences: new Map(),
		user: {id: "me"},
		resolvemember: answer,
		memberListQue: () => {},
	};
	const guild = {id: "g1", localuser, members: new Set(), roleids: new Map()};
	return guild;
}

function userOf(guild: {localuser: object}) {
	return {id: "u1", members: new Map(), webhook: false, localuser: guild.localuser};
}

/** Settles with the lookup's outcome, or "still waiting" after a second. */
function outcome(p: Promise<unknown>) {
	return Promise.race([
		p.then(
			(m) => m,
			(e) => "rejected: " + e,
		),
		new Promise((res) => setTimeout(() => res("still waiting"), 1000)),
	]);
}

it("a member answered without a top-level id (the REST shape) resolves, keyed by its user's id", async () => {
	const guild = guildAnswering(async () => ({
		user: {id: "u1", username: "alice"},
		roles: [],
		nick: null,
	}));
	const user = userOf(guild);

	const member = await outcome(Member.resolveMember(user as never, guild as never));

	expect(member).toBeInstanceOf(Member);
	expect((member as {id: string}).id).toBe("u1");
});

it("a member answer the client can't build settles as no member instead of waiting forever", async () => {
	// Neither an id nor a user.
	const guild = guildAnswering(async () => ({roles: []}));
	const user = userOf(guild);

	expect(await outcome(Member.resolveMember(user as never, guild as never))).toBeUndefined();
	// Later lookups await the same answer.
	expect(await outcome(Member.resolveMember(user as never, guild as never))).toBeUndefined();
});
