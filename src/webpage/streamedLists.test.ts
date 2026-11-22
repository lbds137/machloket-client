import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {makeInviteMenu, makeBanList, streamList} = await import("./guild");
const {Settings} = await import("./settings");
const {I18n} = await import("./i18n");
const {API_TIMEOUT_MS} = await import("./utils/apiFetch");
const {ProgessiveDecodeJSON} = await import("./utils/progessiveLoad");
const {refusalText} = await import("./utils/refusalText");
await I18n.done;

const API = "http://streamed.test/api/v9";
const INVITES = API + "/guilds/g1/invites";
const BANS = API + "/guilds/g1/bans";
const refused = () => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

const guild = {
	id: "g1",
	headers: {Authorization: "t"},
	channels: [],
	info: {api: API, cdn: "http://streamed.test", wellknown: "http://streamed.test"},
	localuser: {userMap: new Map(), guilds: []},
};

const invite = (code: string) => ({
	code,
	uses: 0,
	max_uses: 0,
	created_at: "2026-10-04T00:00:00Z",
	expires_at: null,
	channel_id: "c1",
});
const ban = (id: string, username: string) => ({
	user: {id, username, avatar: null, discriminator: "0"},
	reason: null,
});

/** A 200 whose body sends `first`, then dies (a dropped connection) before the array closes. */
function cutMidList(first: string) {
	return () =>
		new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(first));
					setTimeout(() => controller.error(new TypeError("network error")), 10);
				},
			}),
			{status: 200},
		);
}

/** Builds the invites pane and returns one node holding everything it placed. */
async function inviteList() {
	const menu = new Settings("").addButton("invites");
	const areas = vi.spyOn(menu, "addHTMLArea");
	await makeInviteMenu(menu, guild as never, INVITES);
	const root = document.createElement("div");
	for (const [area] of areas.mock.calls) root.append(area as HTMLElement);
	document.body.append(root);
	return root;
}

function banList() {
	const menu = new Settings("").addButton("bans");
	const root = makeBanList(menu, guild as never);
	document.body.append(root);
	return root;
}

it("a refused invite list says why", async () => {
	captureRequests(INVITES, refused);
	const root = await inviteList();

	await vi.waitFor(() =>
		expect(root.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
});

it("an invite list cut mid-body keeps the invites that arrived and says the network failed", async () => {
	captureRequests(INVITES, cutMidList("[" + JSON.stringify(invite("first")) + ","));
	const root = await inviteList();

	await vi.waitFor(() => expect(root.textContent).toContain(I18n.requestFailed("offline")));
	expect(root.querySelector(".inviteCard .inviteCode")?.textContent).toBe("first");
});

it("a whole invite list shows no failure line (the control)", async () => {
	captureRequests(INVITES, () => Response.json([invite("a"), invite("b")]));
	const root = await inviteList();

	await vi.waitFor(() => expect(root.querySelectorAll(".inviteCard")).toHaveLength(2));
	expect(root.textContent).not.toContain(I18n.requestFailed("offline"));
});

it("a refused ban list says why", async () => {
	captureRequests(BANS, refused);
	const root = banList();

	await vi.waitFor(() =>
		expect(root.textContent).toContain(I18n.requestFailed("Missing Permissions")),
	);
});

it("a ban list cut mid-body keeps the bans that arrived and says the network failed", async () => {
	captureRequests(BANS, cutMidList("[" + JSON.stringify(ban("1", "alice")) + ","));
	const root = banList();

	await vi.waitFor(() => expect(root.textContent).toContain(I18n.requestFailed("offline")));
	expect(root.textContent).toContain("alice");
});

it("a whole ban list shows no failure line (the control)", async () => {
	captureRequests(BANS, () => Response.json([ban("1", "alice"), ban("2", "bob")]));
	const root = banList();

	await vi.waitFor(() => expect(root.querySelectorAll(".bandiv")).toHaveLength(2));
	expect(root.textContent).not.toContain(I18n.requestFailed("offline"));
});

it("the streamed lists drop apiFetch's whole-request budget for an idle one", async () => {
	const timeout = vi.spyOn(AbortSignal, "timeout");
	captureRequests(INVITES, () => Response.json([invite("a")]));
	captureRequests(BANS, () => Response.json([ban("1", "alice")]));

	const invites = await inviteList();
	const bans = banList();
	await vi.waitFor(() => {
		expect(invites.querySelectorAll(".inviteCard")).toHaveLength(1);
		expect(bans.querySelectorAll(".bandiv")).toHaveLength(1);
	});

	expect(timeout).not.toHaveBeenCalledWith(API_TIMEOUT_MS);
});

/** A fetcher whose body the test feeds by hand; an abort errors the body as fetch does. `answer`
 * sets the response's other fields (status text, headers). */
function handFed(status = 200, answer: Omit<ResponseInit, "status"> = {}) {
	let feed!: ReadableStreamDefaultController<Uint8Array>;
	const signals: AbortSignal[] = [];
	const fetcher = (_url: string, init: RequestInit) => {
		if (init.signal) signals.push(init.signal);
		return Promise.resolve(
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						feed = controller;
						init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
							once: true,
						});
					},
				}),
				{...answer, status},
			),
		);
	};
	const send = (text: string) => feed.enqueue(new TextEncoder().encode(text));
	return {fetcher, send, close: () => feed.close(), signals};
}

it("a body that is not JSON closes its load instead of leaving the response open", async () => {
	const {fetcher, send, signals} = handFed();
	const list = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 5_000});
	send("<html>");

	await expect(list).rejects.toThrow("bad JSON");
	expect(signals[0]?.aborted).toBe(true);
});

it.each(["1-2\n", "1e\n", "-\n", "01\n"])(
	"a malformed number %j is a SyntaxError, not a silent NaN",
	async (body) => {
		const {fetcher, send, close} = handFed();
		const decoded = ProgessiveDecodeJSON<number>(API + "/x", {}, fetcher, {idleTimeoutMs: 5_000});
		send(body);
		close();

		await expect(decoded).rejects.toBeInstanceOf(SyntaxError);
	},
);

it("a body that is a bare number decodes it, with no trailing whitespace needed", async () => {
	const {fetcher, send, close} = handFed();
	const decoded = ProgessiveDecodeJSON<number>(API + "/x", {}, fetcher, {idleTimeoutMs: 5_000});
	send("5");
	close();

	expect(await decoded).toBe(5);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Whole = {getWhole(): Promise<unknown>; getNext(): Promise<unknown>};

it("a stream that stalls past the idle budget rejects with a TimeoutError", async () => {
	const {fetcher, send} = handFed();
	const list = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 50});
	send("[1,");

	const outcome = await Promise.race([
		list
			.then((l) => (l as unknown as Whole).getWhole())
			.then(
				() => "resolved",
				(e: DOMException) => e.name,
			),
		sleep(500).then(() => "pending"),
	]);

	expect(outcome).toBe("TimeoutError");
});

it("a refusal whose body stalls still gets its line, within the idle budget", async () => {
	const {fetcher, send} = handFed(403);
	const list = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 50});
	send('{"message": "Missing');

	const outcome = await Promise.race([
		list.then(
			() => "resolved",
			(e: {response?: Response}) => refusalText(e.response),
		),
		sleep(500).then(() => "pending"),
	]);

	expect(outcome).toBe(I18n.requestFailed("HTTP 403"));
});

it("a stream that keeps trickling outlives the idle budget in total", async () => {
	const {fetcher, send, close} = handFed();
	const list = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 50});
	send("[1,");
	const whole = list.then((l) => (l as unknown as Whole).getWhole());
	for (const chunk of ["2,", "3,", "4"]) {
		await sleep(30);
		send(chunk);
	}
	await sleep(30);
	send("]");
	close();

	expect(await whole).toEqual([1, 2, 3, 4]);
});

it("time the reader spends between reads is not counted against the idle budget", async () => {
	const {fetcher, send, close} = handFed();
	const list = (await (async () => {
		const pending = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 50});
		send("[1,");
		return pending;
	})()) as unknown as Whole;

	expect(await list.getNext()).toBe(1);
	await sleep(120); // the reader is busy (building cards); nothing is being awaited from the server
	send("2]");
	close();

	expect(await list.getWhole()).toEqual([2]);
});

it("a body that is a lone value closes its load (no decoder reaches the caller to close it)", async () => {
	const {fetcher, send, close, signals} = handFed();
	const decoded = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 5_000});
	send("null");
	close();

	expect(await decoded).toBe(null);
	expect(signals[0]?.aborted).toBe(true);
});

it("a budgeted refusal keeps its status text and headers (a 429's Retry-After)", async () => {
	const {fetcher, send, close} = handFed(429, {
		statusText: "Too Many Requests",
		headers: {"Retry-After": "5"},
	});
	const list = ProgessiveDecodeJSON<number[]>(API + "/x", {}, fetcher, {idleTimeoutMs: 5_000});
	send('{"message": "slow down"}');
	close();

	const error = await list.then(
		() => null,
		(e: {response: Response}) => e,
	);
	expect(error?.response.statusText).toBe("Too Many Requests");
	expect(error?.response.headers.get("retry-after")).toBe("5");
	expect(await error?.response.json()).toEqual({message: "slow down"});
});

/** Collects the unhandled rejections raised until `stop`, keeping them out of the run's report. */
function trapRejections() {
	const seen: unknown[] = [];
	const onRejection = (event: PromiseRejectionEvent) => {
		seen.push(event.reason);
		event.preventDefault();
	};
	window.addEventListener("unhandledrejection", onRejection);
	return {
		async stop() {
			await sleep(50); // a rejection is reported a task after the promise settles
			window.removeEventListener("unhandledrejection", onRejection);
			return seen;
		},
	};
}

// Responses the server answered with something other than a JSON array of objects. A lone number
// ends in whitespace ("5\n") or with nothing after it ("5"): the decoder reads it either way, and
// the list still says it is unreadable. A 204, a body-less 200 and an empty or whitespace-only body
// have nothing to decode at all.
const unreadable: [string, () => Response][] = [
	["null", () => new Response("null", {status: 200})],
	["a lone number", () => new Response("5\n", {status: 200})],
	["a bare number", () => new Response("5", {status: 200})],
	["an error object", () => new Response('{"message": "x"}', {status: 200})],
	["an empty object", () => new Response("{}", {status: 200})],
	["an array of scalars", () => new Response("[1, 2]", {status: 200})],
	["an HTML page", () => new Response("<!doctype html><html></html>", {status: 200})],
	["a 204", () => new Response(null, {status: 204})],
	["a 200 with no body", () => new Response(null, {status: 200})],
	["an empty body", () => new Response("", {status: 200})],
	["a whitespace body", () => new Response(" \n", {status: 200})],
];

it.each(unreadable)(
	"an invite list answered with %s says the list is unreadable, not offline",
	async (_, respond) => {
		const rejections = trapRejections();
		captureRequests(INVITES, respond);
		const root = await inviteList();

		await vi.waitFor(() => expect(root.textContent).toContain(I18n.listUnreadable()));
		expect(root.textContent).not.toContain(I18n.requestFailed("offline"));
		expect(await rejections.stop()).toEqual([]);
	},
);

it("a ban list whose body is not an array says the list is unreadable, not offline", async () => {
	const rejections = trapRejections();
	captureRequests(BANS, () => Response.json({message: "x"}));
	const root = banList();

	await vi.waitFor(() => expect(root.textContent).toContain(I18n.listUnreadable()));
	expect(root.textContent).not.toContain(I18n.requestFailed("offline"));
	expect(await rejections.stop()).toEqual([]);
});

it("a throw from the item callback reaches the caller instead of reading as offline", async () => {
	captureRequests(INVITES, () => Response.json([invite("a")]));
	const bug = new Error("card builder bug");
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	await expect(
		streamList(INVITES, {}, () => {
			throw bug;
		}),
	).rejects.toBe(bug);
	const load = fetchSpy.mock.calls.find((call) => String(call[0]) === INVITES);
	expect(load?.[1]?.signal?.aborted).toBe(true); // the load is closed on the way out
});
