import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
await (
	await import("./i18n")
).I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	for (const id of ["typediv", "scrollWrap"]) document.getElementById(id)?.remove();
});

/** A forum's page, its new-post editor open with `content` typed and a title given. */
async function newPostEditor() {
	for (const id of ["typediv", "scrollWrap"]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}
	const goTo = vi.fn();
	const forum = Object.assign(Object.create(Channel.prototype), {
		id: "300",
		flags: 0,
		owner: {
			info: {api: "http://forum.test/api/v9"},
			localuser: {goToChannel: goTo, keyup: () => false, keydown() {}, search() {}},
		},
		headers: {},
		availableTags: [],
		hasPermission: () => true,
	}) as InstanceType<typeof Channel>;
	vi.spyOn(forum, "forumSearch").mockResolvedValue(undefined);
	forum.renderForum();
	const post = document.querySelector<HTMLButtonElement>(".newPostForumButton")!;
	post.click(); // opens the editor
	document.querySelector<HTMLInputElement>(".forumSearch")!.value = "A title";
	const area = document.querySelector<HTMLElement>(".editMessage")!;
	area.textContent = "Hello";
	area.dispatchEvent(new InputEvent("input", {bubbles: true}));
	return {post, goTo, error: () => document.querySelector(".forumPostError")!.textContent};
}

it("a refused new post says so instead of opening a channel that doesn't exist", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "Missing Permissions", code: 50013}, {status: 403}),
	);
	const {post, goTo, error} = await newPostEditor();

	post.click();
	await vi.waitFor(() => expect(error()).toContain("Missing Permissions"));

	expect(goTo).not.toHaveBeenCalled();
});

it("after a refused post, the button works again", async () => {
	const sent = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(Response.json({message: "rate limited"}, {status: 429}))
		.mockResolvedValueOnce(Response.json({id: "301"}));
	const {post, goTo, error} = await newPostEditor();

	post.click();
	await vi.waitFor(() => expect(error()).toContain("rate limited"));
	expect(post.disabled).toBe(false);
	post.click();
	await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith("301"));

	expect(sent).toHaveBeenCalledTimes(2);
});

it("a new post that can't reach the instance says so", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	const {post, goTo, error} = await newPostEditor();

	post.click();
	await vi.waitFor(() => expect(error()).toContain("offline"));

	expect(goTo).not.toHaveBeenCalled();
});

it("a second tap while the post is sending doesn't post it twice", async () => {
	let answer!: () => void;
	const sent = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(
			() => new Promise((res) => (answer = () => res(Response.json({id: "301"})))),
		);
	const {post, goTo} = await newPostEditor();

	post.click();
	post.click();
	answer();
	await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith("301"));

	expect(sent).toHaveBeenCalledTimes(1);
});
