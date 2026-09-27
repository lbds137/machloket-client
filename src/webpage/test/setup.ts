import {vi} from "vitest";

// The app fetches its instance list and runs instance discovery at module load, so tests
// answer those requests in memory. Everything else (translations, assets) goes to the
// Vitest dev server.

export const localInstances = [
	{name: "This host", icon: "/logo.svg", url: "http://{hostname}:3001"},
	{name: "Other instance", url: "http://other.test"},
];

type Route = () => Promise<Response>;
const testNetwork = new Map<string, Route>();

function json(body: unknown) {
	return new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
}

/** A Spacebar instance at `origin` whose well-known answers after `delayMs`. */
export function addInstance(origin: string, delayMs = 0) {
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

const realFetch = globalThis.fetch.bind(globalThis);
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : input, location.href);
	const route = testNetwork.get(url.origin + url.pathname);
	if (route) return route();
	if (url.origin === location.origin && url.pathname === "/instances.json") {
		return json(localInstances);
	}
	if (url.origin !== location.origin) return new Response("not found", {status: 404});
	return realFetch(input, init);
});
