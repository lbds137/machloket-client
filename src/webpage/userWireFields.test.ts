import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");

// The @me wire carries fields (nsfw_allowed and friends) that only mainuserjson types and only
// the self user receives. The class never assigns them in a constructor: userupdate's dynamic
// copy is the whole mechanism. These pins guard that mechanism — if the copy ever forwards only
// an explicit key list (one derived from the base userjson, which lacks the key) or normalizes
// null away, the typed reads (channel.ts nsfwPannel/nsfwGated) would silently read undefined
// while the gate stays green.
it("userupdate's dynamic copy lands a wire-only @me field on the instance", () => {
	// No username anywhere in the payload: a username "change" fires nameChange, which walks
	// localuser.guilds — constructor-less fakes don't survive that (the badge pins avoid it too).
	const user = Object.assign(Object.create(User.prototype), {
		id: "u9",
		owner: {info: {api: "http://wire.test/api/v9"}, headers: {}, badges: new Map()},
	}) as InstanceType<typeof User>;

	// Tri-state honesty first: an unattested account's null must not collapse to undefined.
	user.userupdate({id: "u9", nsfw_allowed: null} as never);
	expect(user.nsfw_allowed).toBe(null);

	user.userupdate({id: "u9", nsfw_allowed: true} as never);
	expect(user.nsfw_allowed).toBe(true);
});
