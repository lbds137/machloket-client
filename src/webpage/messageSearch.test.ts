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

it("a refused re-sort says why inside the panel, keeping its sort bar and page buttons", async () => {
	const answers = [
		Response.json({messages: [], total_results: 0}),
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	];
	captureRequests(SEARCH, () => answers.shift()!);
	const {localuser, sideDiv} = searcher();
	localuser.mSearch("hello");
	await vi.waitFor(() => expect(sideDiv.querySelector(".sortBar")).not.toBeNull());
	sideDiv.scrollTop = 0;

	(sideDiv.querySelector(".sortBar button:last-child") as HTMLButtonElement).click();

	await vi.waitFor(() =>
		expect(sideDiv.querySelector("h3.searchRefusal")?.textContent).toBe(
			I18n.requestFailed("Missing Access"),
		),
	);
	expect(sideDiv.querySelector(".sortBar")).not.toBeNull();
	expect(sideDiv.querySelector(".searchNavButtons")).not.toBeNull();
	expect(sideDiv.textContent).not.toContain(I18n.search.nofind());
});

/** Channel c1 holding message m1, which renders as "old hit". */
function channelWithHit(localuser: InstanceType<typeof Localuser>) {
	const channel = {name: "general", messages: new Map()};
	const hit = {
		channel,
		buildhtml: () => Object.assign(document.createElement("div"), {textContent: "old hit"}),
	};
	channel.messages.set("m1", hit);
	localuser.channelids.set("c1", channel as never);
	return {messages: [[{id: "m1", channel_id: "c1"}]], total_results: 1};
}

it("a refused filter change drops the old filter's results", async () => {
	const refused = Response.json({code: 50001, message: "Missing Access"}, {status: 403});
	const {localuser, sideDiv} = searcher();
	const answers = [Response.json(channelWithHit(localuser)), refused];
	captureRequests(SEARCH, () => answers.shift()!);
	localuser.mSearch("hello");
	await vi.waitFor(() => expect(sideDiv.textContent).toContain("old hit"));

	(sideDiv.querySelector(".sortBar button") as HTMLButtonElement).click();
	(document.querySelector(".background") as HTMLElement).click();

	await vi.waitFor(() => expect(sideDiv.querySelector("h3.searchRefusal")).not.toBeNull());
	expect(sideDiv.textContent).not.toContain("old hit");
	expect(sideDiv.querySelector(".sortBar")).not.toBeNull();
});

it("a refused re-sort leaves the picked order highlighted, the order a retry uses", async () => {
	const answers = [
		Response.json({messages: [], total_results: 0}),
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	];
	captureRequests(SEARCH, () => answers.shift()!);
	const {localuser, sideDiv} = searcher();
	localuser.mSearch("hello");
	await vi.waitFor(() => expect(sideDiv.querySelector(".sortBar")).not.toBeNull());
	const [newest, oldest] = [...sideDiv.querySelectorAll(".sortBar button")].slice(-2);

	(oldest as HTMLButtonElement).click();

	await vi.waitFor(() => expect(sideDiv.querySelector("h3.searchRefusal")).not.toBeNull());
	expect(oldest.classList.contains("selectedB")).toBe(true);
	expect(newest.classList.contains("selectedB")).toBe(false);
});

it("a page that comes back empty, then refused on the page before, keeps the sort bar", async () => {
	const {localuser, sideDiv} = searcher();
	const fifty = channelWithHit(localuser);
	fifty.messages = Array.from({length: 50}, () => [{id: "m1", channel_id: "c1"}]);
	const answers = [
		Response.json(fifty),
		Response.json({messages: [], total_results: 50}),
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	];
	captureRequests(SEARCH, () => answers.shift()!);
	localuser.mSearch("hello");
	await vi.waitFor(() => expect(sideDiv.querySelector(".searchNavButtons")).not.toBeNull());

	(sideDiv.querySelector(".searchNavButtons button:last-child") as HTMLButtonElement).click();

	await vi.waitFor(() => expect(sideDiv.querySelector("h3.searchRefusal")).not.toBeNull());
	expect(sideDiv.querySelector(".sortBar")).not.toBeNull();
});

it("a DM search with no channel open clears the last search's results", async () => {
	const {localuser, sideDiv} = searcher("hit from the last search");
	Object.assign(localuser, {lookingguild: {id: "@me"}, channelfocus: undefined});

	localuser.mSearch("hello");

	expect(sideDiv.textContent).toBe("");
});

it("a new search's refused first page doesn't keep the last search's sort bar", async () => {
	const answers = [
		Response.json({messages: [], total_results: 0}),
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	];
	captureRequests(SEARCH, () => answers.shift()!);
	const {localuser, sideDiv} = searcher();
	localuser.mSearch("hello");
	await vi.waitFor(() => expect(sideDiv.querySelector(".sortBar")).not.toBeNull());

	localuser.mSearch("goodbye");

	await vi.waitFor(() => expect(sideDiv.querySelector("h3.searchRefusal")).not.toBeNull());
	expect(sideDiv.querySelector(".sortBar")).toBeNull();
});

it("a first-page refusal is a heading", async () => {
	captureRequests(SEARCH, () =>
		Response.json({code: 50001, message: "Missing Access"}, {status: 403}),
	);
	const {localuser, sideDiv} = searcher();

	localuser.mSearch("hello");

	await vi.waitFor(() =>
		expect(sideDiv.querySelector("h3.searchRefusal")?.textContent).toBe(
			I18n.requestFailed("Missing Access"),
		),
	);
});

it("a DM search with no channel open asks nothing", async () => {
	const sent = captureRequests(API + "/channels/undefined/messages/search/", () =>
		Response.json({messages: []}),
	);
	const {localuser} = searcher();
	Object.assign(localuser, {lookingguild: {id: "@me"}, channelfocus: undefined});

	localuser.mSearch("hello");
	await new Promise((r) => setTimeout(r, 50));

	expect(sent).toEqual([]);
});

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
