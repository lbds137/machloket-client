import {expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

const API = "http://forum.test/api/v9";

it("a forum's post data is asked for in batches of at most 100 threads, one batch at a time", async () => {
	let inFlight = 0;
	let mostInFlight = 0;
	const sent = captureRequests(API + "/channels/f1/post-data", async () => {
		mostInFlight = Math.max(mostInFlight, ++inFlight);
		await new Promise((res) => setTimeout(res, 5));
		inFlight--;
		return Response.json({threads: {}});
	});
	const children = Array.from({length: 250}, (_, i) => ({id: "t" + i}));
	const forum = Object.assign(Object.create(Channel.prototype), {
		id: "f1",
		children,
		headers: {},
		owner: {info: {api: API}},
	}) as InstanceType<typeof Channel>;

	await forum.fetchForum();

	const batches = sent.map((body) => (body as {thread_ids: string[]}).thread_ids);
	expect(batches.map((ids) => ids.length)).toEqual([100, 100, 50]);
	expect(batches.flat()).toEqual(children.map(({id}) => id));
	expect(mostInFlight).toBe(1);
	expect(forum.hasFetchedForForum).toBe(true);
});

it("a refused batch fails with its status and leaves the forum unfetched", async () => {
	captureRequests(API + "/channels/f2/post-data", () =>
		Response.json({message: "too many"}, {status: 400}),
	);
	const forum = Object.assign(Object.create(Channel.prototype), {
		id: "f2",
		children: [{id: "t1"}],
		headers: {},
		owner: {info: {api: API}},
	}) as InstanceType<typeof Channel>;

	await expect(forum.fetchForum()).rejects.toThrow("HTTP 400");
	expect(forum.hasFetchedForForum).toBeFalsy();
});

/** Forum f3 with three posts, every one of them already listed, drawn into a fresh view. */
function forumWithPosts() {
	const posts = Array.from({length: 3}, (_, i) => ({
		id: String(1553128655016763450n + BigInt(i)),
		name: "post " + i,
		appliedTags: [],
		renderThread: async () =>
			Object.assign(document.createElement("div"), {className: "postProbe"}),
	}));
	const forum = Object.assign(Object.create(Channel.prototype), {
		id: "f3",
		owner: {info: {api: API}},
		headers: {},
		children: posts,
		availableTags: [],
		hasAllThreads: true,
		forumFilters: {recentFirst: true, sortActive: false, tagMatchAll: false, tags: []},
	}) as InstanceType<typeof Channel>;
	const view = document.createElement("div");
	document.body.append(view);
	return {forum, view};
}

const button = (view: HTMLElement, text: string) =>
	[...view.querySelectorAll("button")].find((b) => b.textContent === text);

it("a forum whose post data was refused says why and offers another go", async () => {
	const {I18n} = await import("./i18n");
	await I18n.done;
	const answers = [
		Response.json({message: "You are being rate limited."}, {status: 429}),
		Response.json({threads: {}}),
	];
	captureRequests(API + "/channels/f3/post-data", () => answers.shift()!);
	const {forum, view} = forumWithPosts();

	// The view is the outcome (its callers drop the promise), so a rejection is not the test.
	await forum.forumSearch("", view).catch(() => {});

	expect(view.textContent).toContain(I18n.requestFailed("You are being rate limited."));
	button(view, I18n.tryAgain())!.click();
	await vi.waitFor(() => expect(view.querySelectorAll(".postProbe")).toHaveLength(3));
	view.remove();
});

it("a forum whose post data never arrived says it's offline", async () => {
	const {I18n} = await import("./i18n");
	await I18n.done;
	captureRequests(API + "/channels/f3/post-data", () =>
		Promise.reject(new TypeError("Failed to fetch")),
	);
	const {forum, view} = forumWithPosts();

	await forum.forumSearch("", view).catch(() => {});

	expect(view.textContent).toContain(I18n.requestFailed("offline"));
	view.remove();
});

it("post data that isn't post data says what came back, not offline", async () => {
	const {I18n} = await import("./i18n");
	await I18n.done;
	captureRequests(API + "/channels/f3/post-data", () => new Response("<html>portal</html>"));
	const {forum, view} = forumWithPosts();

	await forum.forumSearch("", view).catch(() => {});

	expect(view.textContent).toContain(I18n.requestFailed("HTTP 200"));
	view.remove();
});

it("two searches started together (opening, then typing) ask for the post data once", async () => {
	const sent = captureRequests(API + "/channels/f3/post-data", async () => {
		await new Promise((res) => setTimeout(res, 5));
		return Response.json({threads: {}});
	});
	const {forum, view} = forumWithPosts();

	await Promise.all([forum.forumSearch("", view), forum.forumSearch("po", view)]);

	expect(sent).toHaveLength(1);
	view.remove();
});

it("two searches sharing a refused post-data request both read the server's reason", async () => {
	const {I18n} = await import("./i18n");
	await I18n.done;
	captureRequests(API + "/channels/f3/post-data", async () => {
		await new Promise((res) => setTimeout(res, 5));
		return Response.json({code: 50001, message: "Missing Access"}, {status: 403});
	});
	const {forum, view} = forumWithPosts();
	// Whichever search draws last wins the view, so check every drawing, not just the last.
	const drawn: string[] = [];
	const draw = view.replaceChildren.bind(view);
	view.replaceChildren = (...nodes) => {
		draw(...nodes);
		drawn.push(view.textContent ?? "");
	};

	await Promise.all([forum.forumSearch("", view), forum.forumSearch("po", view)]);

	expect(drawn).toHaveLength(2);
	for (const text of drawn) expect(text).toContain(I18n.requestFailed("Missing Access"));
	view.remove();
});
