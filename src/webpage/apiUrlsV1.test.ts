import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {getApiUrlsV1} = await import("./utils/utils");

afterEach(() => {
	vi.restoreAllMocks();
});

/** The first URL getApiUrlsV1 asks for when given `typed`; `expected` is the one it should ask
 * for. Only the request is read, never an answer: the test network (test/setup.ts) answers every
 * host in memory, so nothing here reaches a real server, even where one listens on that port. */
async function firstRequest(typed: string, expected: string) {
	captureRequests(expected, () => new Response("not found", {status: 404}));
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	await getApiUrlsV1(typed);
	const [input] = fetchSpy.mock.calls[0];
	return String(input instanceof Request ? input.url : input);
}

describe("getApiUrlsV1 with a typed address", () => {
	it("a bare loopback host:port is looked up over http://", async () => {
		// `localhost:3001` parses as a URL (scheme `localhost:`), which must not skip the host rule.
		const expected = "http://localhost:3001/.well-known/spacebar";
		expect(await firstRequest("localhost:3001", expected)).toBe(expected);
	});

	it("a bare loopback address is looked up over http:// too", async () => {
		const expected = "http://127.0.0.1:3001/.well-known/spacebar";
		expect(await firstRequest("127.0.0.1:3001", expected)).toBe(expected);
	});

	it("a bare host elsewhere is still looked up over https://", async () => {
		const expected = "https://example.org/.well-known/spacebar";
		expect(await firstRequest("example.org", expected)).toBe(expected);
	});

	it("an address that names its scheme is kept as typed", async () => {
		const expected = "http://example.org:8080/.well-known/spacebar";
		expect(await firstRequest("http://example.org:8080", expected)).toBe(expected);
	});
});
