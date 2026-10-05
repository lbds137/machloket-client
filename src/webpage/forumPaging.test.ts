import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
await (
	await import("./i18n")
).I18n.done;

it("changing a filter on a later page starts the list again from its first page", async () => {
	const tag = {
		id: "t1",
		name: "Books",
		makeHTML: () => Object.assign(document.createElement("span"), {className: "tagProbe"}),
	};
	// 30 posts, all tagged: a page of 25, then 5.
	const posts = Array.from({length: 30}, (_, i) => ({
		id: String(1553128655016763450n + BigInt(i)),
		name: "post " + i,
		appliedTags: ["t1"],
		renderThread: async () =>
			Object.assign(document.createElement("div"), {className: "postProbe"}),
	}));
	const forum = Object.assign(Object.create(Channel.prototype), {
		children: posts,
		availableTags: [tag],
		hasAllThreads: true,
		hasFetchedForForum: true,
		forumFilters: {recentFirst: true, sortActive: false, tagMatchAll: false, tags: []},
	}) as InstanceType<typeof Channel>;
	const view = document.createElement("div");
	document.body.append(view);
	const settle = () => new Promise((res) => setTimeout(res, 50));
	const shown = () => view.querySelectorAll(".postProbe").length;

	await forum.forumSearch("", view);
	(view.querySelector(".forumButtonRow")!.lastElementChild as HTMLButtonElement).click(); // Next
	await settle();
	expect(shown()).toBe(5);

	view.querySelector<HTMLElement>(".tagProbe")!.click(); // filter by the tag every post has
	await settle();

	expect(shown()).toBe(25);
	view.remove();
});

afterEach(() => vi.restoreAllMocks());

it("a refused post search still shows the posts already loaded", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "rate limited", retry_after: 1}, {status: 429}),
	);
	const posts = Array.from({length: 3}, (_, i) => ({
		id: String(1553128655016763450n + BigInt(i)),
		name: "post " + i,
		appliedTags: [],
		renderThread: async () =>
			Object.assign(document.createElement("div"), {className: "postProbe"}),
	}));
	const forum = Object.assign(Object.create(Channel.prototype), {
		id: "300",
		owner: {info: {api: "http://forum.test/api/v9"}},
		headers: {},
		children: posts,
		availableTags: [],
		hasAllThreads: false,
		hasFetchedForForum: true,
		umap: new Map(),
		search: [],
		forumFilters: {recentFirst: true, sortActive: false, tagMatchAll: false, tags: []},
	}) as InstanceType<typeof Channel>;
	const view = document.createElement("div");
	document.body.append(view);

	await forum.forumSearch("", view);

	expect(view.querySelectorAll(".postProbe")).toHaveLength(3);
	view.remove();
});
