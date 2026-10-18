import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://search.test/api/v9";
const SEARCH = API + "/guilds/g1/messages/search/";

afterEach(() => {
	document.body.replaceChildren();
});

it("an answer with no message list says so instead of keeping the last results", async () => {
	captureRequests(SEARCH, () => Response.json({}));
	const {localuser, sideDiv} = searcher("hit from the last search");

	localuser.mSearch("hello");

	await vi.waitFor(() => expect(sideDiv.textContent).toBe(I18n.requestFailed("HTTP 200")));
});

/** A user looking at guild g1, with the search panel in the page; the panel holds `shown`. */
function searcher(shown = "") {
	const sideContainDiv = Object.assign(document.createElement("div"), {id: "sideContainDiv"});
	const sideDiv = Object.assign(document.createElement("div"), {id: "sideDiv"});
	sideDiv.textContent = shown;
	sideContainDiv.append(sideDiv);
	document.body.append(sideContainDiv);
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		lookingguild: {id: "g1"},
		channelids: new Map(),
	}) as InstanceType<typeof Localuser>;
	return {localuser, sideDiv};
}

it("a refused search says why instead of keeping the last search's results", async () => {
	captureRequests(SEARCH, () =>
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	);
	const {localuser, sideDiv} = searcher("hit from the last search");

	localuser.mSearch("hello");

	await vi.waitFor(() => expect(sideDiv.textContent).toBe(I18n.requestFailed("Missing Access")));
});

it("a search that never reached the server says it's offline", async () => {
	captureRequests(SEARCH, () => Promise.reject(new TypeError("Failed to fetch")));
	const {localuser, sideDiv} = searcher("hit from the last search");

	localuser.mSearch("hello");

	await vi.waitFor(() => expect(sideDiv.textContent).toBe(I18n.requestFailed("offline")));
});

it("a rate-limited search asks again once the server's window is over", async () => {
	const answers = [
		Response.json({message: "You are being rate limited.", retry_after: 0.01}, {status: 429}),
		Response.json({messages: [], total_results: 0}),
	];
	const sent = captureRequests(SEARCH, () => answers.shift()!);
	const {localuser, sideDiv} = searcher();

	localuser.mSearch("hello");

	await vi.waitFor(() => expect(sideDiv.textContent).toContain(I18n.search.nofind()));
	expect(sent).toHaveLength(2);
});

it("an answer to a search the user has replaced is dropped, refusal or not", async () => {
	let answer: (res: Response) => void = () => {};
	captureRequests(SEARCH, () => new Promise<Response>((r) => (answer = r)));
	const {localuser, sideDiv} = searcher();

	localuser.mSearch("first");
	localuser.curSearch = Symbol("a newer search");
	answer(Response.json({code: 50001, message: "Missing Access"}, {status: 403}));
	await new Promise((r) => setTimeout(r, 50));

	expect(sideDiv.textContent).toBe("");
});
