import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

/** A forum holding posts with these ids, sorted by creation, newest first. */
function forumWith(ids: string[]) {
	return Object.assign(Object.create(Channel.prototype), {
		children: ids.map((id) => ({id, name: "post " + id, appliedTags: []})),
		forumFilters: {recentFirst: true, sortActive: false, tagMatchAll: false, tags: []},
	}) as InstanceType<typeof Channel>;
}

it("sorts posts made in the same instant (ids past 2^53) newest first, whatever order they came in", () => {
	// Real snowflakes: these two differ only in the last digit, which a Number can't hold.
	const older = "1553128655016763450";
	const newer = "1553128655016763451";

	for (const order of [
		[older, newer],
		[newer, older],
	]) {
		const [posts] = forumWith(order).genCurSort("", 0);
		expect(posts.map((post) => post.id)).toEqual([newer, older]);
	}
});

it("by recent activity, a post with a send still pending counts as the most active", () => {
	const forum = forumWith(["1553128655016763450", "1553128655016763451"]);
	Object.assign(forum.forumFilters, {sortActive: true});
	Object.assign(forum.children[0], {lastmessageid: "fake0.25"});

	const [posts] = forum.genCurSort("", 0);

	expect(posts.map((post) => post.id)).toEqual(["1553128655016763450", "1553128655016763451"]);
});
