import {expect, it} from "vitest";
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
