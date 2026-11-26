import {beforeEach, vi} from "vitest";
import {resetRateLimitsForTests} from "../utils/rateLimitWindows.js";

// Every test starts with no 429 window armed (the registry is module-global).
beforeEach(() => resetRateLimitsForTests());

// The app fetches its instance list and runs instance discovery at module load, so tests
// answer those requests in memory. Everything else (translations, assets) goes to the
// Vitest dev server.

export const localInstances = [
	{name: "Spacebar", icon: "/logo.svg", url: "https://spacebar.test"},
	{name: "This host", icon: "/logo.svg", url: "http://{hostname}:3001"},
	{name: "Other instance", url: "http://other.test"},
];

type Route = () => Promise<Response>;
const testNetwork = new Map<string, Route>();

function json(body: unknown) {
	return new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
}

/** A Spacebar instance at `origin` whose well-known answers after `delayMs`. `authCookie`
 * makes its discovery (`/policies/instance/domains`) offer cookie sessions; without it the
 * route answers like a stock instance, with no `authCookie` key. */
export function addInstance(origin: string, delayMs = 0, opts?: {authCookie?: boolean}) {
	// Register asks /ping for the instance's terms-of-service page.
	testNetwork.set(origin + "/api/v9/ping", async () => json({instance: {tosPage: null}}));
	testNetwork.set(origin + "/api/v9/policies/instance/domains", async () =>
		json({
			api: origin + "/api/",
			cdn: origin,
			gateway: origin.replace(/^http/, "ws"),
			...(opts?.authCookie && {authCookie: true}),
		}),
	);
	testNetwork.set(
		origin + "/.well-known/spacebar/client",
		() =>
			new Promise((res) =>
				setTimeout(
					() =>
						res(
							json({
								api: {baseUrl: origin},
								gateway: {baseUrl: origin.replace(/^http/, "ws")},
								cdn: {baseUrl: origin},
							}),
						),
					delayMs,
				),
			),
	);
}

/** A host that isn't a Spacebar instance: its well-known 404s after `delayMs`. */
export function addDeadHost(origin: string, delayMs = 0) {
	testNetwork.set(
		origin + "/.well-known/spacebar/client",
		() =>
			new Promise((res) =>
				setTimeout(() => res(new Response("not found", {status: 404})), delayMs),
			),
	);
}

/**
 * `POST <origin>/api/v9/auth/<route>` on a test instance answers `{token}`. The answer waits for
 * the returned `release()`, so a test can act while the request is in flight.
 */
export function acceptAuth(origin: string, route: "login" | "register", token: string) {
	let release!: () => void;
	const released = new Promise<void>((res) => (release = res));
	let requested!: () => void;
	const requestSeen = new Promise<void>((res) => (requested = res));
	testNetwork.set(origin + "/api/v9/auth/" + route, async () => {
		requested();
		await released;
		return json({token});
	});
	return {release, requestSeen};
}

/**
 * Settles the fetch-continuation chains a test started, for a negative assert that follows:
 * animation frames stretch under a loaded runner instead of expiring, unlike a fixed sleep
 * (the unit-tier twin of the e2e drain). Same caveat as its twin: rAF pauses on a hidden
 * page, so a drain there hangs to the test timeout — visible, never a false pass.
 */
export async function drain() {
	for (let i = 0; i < 2; i++) {
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		await new Promise((r) => setTimeout(r, 0));
	}
}

/**
 * Records every request to `url` (origin + path) and answers each with `respond()`; returns the
 * recorded requests' parsed JSON bodies, in order.
 */
export function captureRequests(
	url: string,
	respond: () => Response | Promise<Response> = () => new Response(null, {status: 204}),
) {
	const bodies: unknown[] = [];
	captures.set(url, {bodies, respond});
	return bodies;
}
/** One request `recordRequests` saw: its parsed JSON body, headers and credentials mode. */
export type RecordedRequest = {body: unknown; headers: Headers; credentials?: RequestCredentials};
/**
 * Like captureRequests, but keeps each request's headers and `credentials` too (as the app's
 * fetch wrapper left them), for asserts on what a request carried.
 */
export function recordRequests(
	url: string,
	respond: () => Response | Promise<Response> = () => new Response(null, {status: 204}),
) {
	const requests: RecordedRequest[] = [];
	recorders.set(url, {requests, respond});
	return requests;
}
const recorders = new Map<
	string,
	{requests: RecordedRequest[]; respond: () => Response | Promise<Response>}
>();
const captures = new Map<
	string,
	{bodies: unknown[]; respond: () => Response | Promise<Response>}
>();

const realFetch = globalThis.fetch.bind(globalThis);
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : input, location.href);
	const recorder = recorders.get(url.origin + url.pathname);
	if (recorder) {
		recorder.requests.push({
			body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
			headers: new Headers(init?.headers),
			credentials: init?.credentials,
		});
		return recorder.respond();
	}
	const capture = captures.get(url.origin + url.pathname);
	if (capture) {
		capture.bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);
		return capture.respond();
	}
	const route = testNetwork.get(url.origin + url.pathname);
	if (route) return route();
	if (url.origin === location.origin && url.pathname === "/instances.json") {
		return json(localInstances);
	}
	if (url.origin !== location.origin) return new Response("not found", {status: 404});
	return realFetch(input, init);
});

/** Runs `fn` with `navigator.locks` gone, as in an insecure context or a browser without Web
 * Locks. The stub is an own property over the prototype's getter; whatever own property was
 * there before (another stub's) comes back afterwards. */
export async function withoutWebLocks<T>(fn: () => Promise<T>): Promise<T> {
	const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
	Object.defineProperty(navigator, "locks", {configurable: true, value: undefined});
	try {
		return await fn();
	} finally {
		if (previous) Object.defineProperty(navigator, "locks", previous);
		else Reflect.deleteProperty(navigator, "locks");
	}
}
