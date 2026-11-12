import type {messageFrom, messageTo} from "./utils/serviceType";

// Registered as /service.js?notifications in the default mode (utils.ts, SW.register): it only
// shows and opens notifications (Android Chrome has no `new Notification`), and leaves fetches
// and caches alone. Without a fetch listener the browser doesn't route requests through it.
const notificationsOnly = new URL(self.location.href).searchParams.has("notifications");

// The worker sits at a stable URL, so its bytes are its identity: this line is what makes a
// new build's service.js differ (and the browser ever reinstall it). Not read by any logic.
console.log("[SW] build", __BUILD_REVISION__);

async function deleteoldcache() {
	await caches.delete("cache");
}
type files = {[key: string]: string | files};
async function getAllFiles() {
	const files = await fetch(new URL("/files.json", self.location.origin).href, {cache: "no-store"});
	const json: files = await files.json();
	return json;
}
async function downloadAllFiles() {
	async function cachePath(path: string, json: files) {
		await Promise.all(
			Object.entries(json).map(async ([name, thing]) => {
				if (typeof thing === "string") {
					const lpath = path + "/" + name;
					if (lpath.endsWith(".map") && !dev) {
						return;
					}
					const res = await fetch(lpath);
					// Awaited so the marker write cannot outrun the cache writes, and ok-guarded:
					// a 404/500 for a listed file must not be cached as that file's shell.
					if (res.ok) await putInCache(new URL(lpath, self.location.origin), res);
				} else {
					await cachePath(path + "/" + name, thing);
				}
			}),
		);
	}

	const json = await getAllFiles();

	await cachePath("", json);
}
let swStorage = {} as Record<string, number>;
async function swStorageGet() {
	return JSON.parse(
		(await (await (await caches.open("save")).match("/save"))?.text()) || "{}",
	) as Record<string, number>;
}
async function pruneCdnCache(_: Record<string, number>) {
	function pathToTime(str: string): number {
		return swStorage[str] ?? 0;
	}
	swStorage = _;
	if (Object.keys(_).length === 0) {
		caches.delete("cdn");
	} else {
		const c = await caches.open("cdn");
		let stuff = (await cacheSize("cdn")).sort((a, b) => pathToTime(b[2]) - pathToTime(a[2]));
		let size = stuff.reduce((c, l) => c + l[0], 0);
		while (size > 100000000) {
			const thing = stuff.pop()!;
			c.delete(thing[2]);
			size -= thing[0];
		}
	}
}
if (!notificationsOnly) swStorageGet().then(pruneCdnCache);
async function swStorageSave() {
	const c = await caches.open("save");
	c.put("/save", new Response(JSON.stringify(swStorage)));
}
async function cacheSize(str: string) {
	const c = await caches.open(str);
	const keys = await c.keys();

	const sum = (
		await Promise.all(
			keys.map((req) =>
				c.match(req).then((res) =>
					res!
						.clone()
						.blob()
						.then((b) => [b.size, res!, res!.url] as const),
				),
			),
		)
	).sort((a, b) => b[0] - a[0]);
	return sum;
}
async function getFromCache(request: URL) {
	request = new URL(request, self.location.href);
	const port = rMap.get(request.host);
	if (port) {
		request.search = "";
	}
	const cache = await caches.open(port ? "cdn" : "cache");
	if (port) {
		swStorage[request + ""] = Date.now();
		swStorageSave();
	}
	return cache.match(request);
}
async function putInCache(request: URL | string, response: Response) {
	request = new URL(request, self.location.href);
	const port = rMap.get(request.host);
	if (port) {
		request.search = "";
	}
	const cache = await caches.open(port ? "cdn" : "cache");
	if (port) {
		swStorage[request + ""] = Date.now();
		swStorageSave();
	}
	try {
		await cache.put(request, response);
	} catch (error) {
		console.error(error);
	}
}

let lastcache: string;
if (!notificationsOnly) {
	self.addEventListener("activate", async () => {
		console.log("Service Worker activated");
		checkCache();
	});
}
async function tryToClose() {
	const portArr = [...ports];
	// An update can land with no client connected (activate-time check): closing nobody is
	// fine — throwing would be an unhandled rejection.
	if (!portArr.length) {
		return;
	}
	for (let i = 1; i < portArr.length; i++) {
		portArr[i].postMessage({code: "closing"});
	}
	portArr[0].postMessage({code: "close"});
}
function sendAll(message: messageFrom) {
	for (const port of ports) {
		port.postMessage(message);
	}
}
async function checkCache() {
	// Set before any await: getfile calls checkCache unawaited, so without an entry guard
	// every request of a burst fired its own /getupdates fetch. Reset 30 minutes later, or
	// right away if this check fails.
	if (checkedrecently) {
		return false;
	}
	checkedrecently = true;
	if (guardTimer !== undefined) {
		clearTimeout(guardTimer);
	}
	guardTimer = setTimeout(
		(_: any) => {
			checkedrecently = false;
		},
		1000 * 60 * 30,
	);
	try {
		const cache = await caches.open("cache");
		const promise = await cache.match("/getupdates");
		if (promise) {
			lastcache = await promise.text();
		}
		const data = await fetch("/getupdates", {cache: "no-store"});
		if (!data.ok) return false;
		const text = await data.clone().text();
		// The SPA fallback answering /getupdates with index.html is not an update: treating it
		// as one would pin that HTML as the app shell in every cache. Mark updates
		// unavailable for this session so getfile stops trusting the cache instead.
		if (
			data.headers.get("content-type")?.includes("text/html") ||
			text.trimStart().startsWith("<")
		) {
			updatesUnavailable = true;
			return false;
		}
		if (lastcache !== text) {
			// Order matters: the marker ("/getupdates" in the cache) is the "an update is
			// ready" signal for clients, so it is stored only once the new build is actually
			// cached — otherwise a crash between them loses the marker (and the update).
			await deleteoldcache();
			try {
				await downloadAllFiles();
			} catch (e) {
				// A failed download writes no marker and broadcasts nothing: the marker is the
				// "an update is ready" signal, and clients acting on it would find a cache the
				// failed pass already emptied. checkedrecently deliberately stays set — a reset
				// would re-run delete+download on every request of a burst against a permanently
				// broken server; the retry happens at the next 30-minute window or a manual
				// CheckUpdate (which resets the guard itself).
				console.error("could not pre-warm the cache", e);
				return false;
			}
			await putInCache("/getupdates", data);
			lastcache = text;
			tryToClose();
			sendAll({
				code: "updates",
				updates: true,
			});
			return true;
		}
		return false;
	} catch (e) {
		// A transient failure must not block update checks for the next 30 minutes.
		console.error("update check failed", e);
		checkedrecently = false;
		if (guardTimer !== undefined) {
			clearTimeout(guardTimer);
		}
		return false;
	}
}
var checkedrecently = false;
// Handle for the 30-minute guard reset scheduled in checkCache: a new check cancels the
// previous timer, and so does a failed check — a stale timer must not reopen the guard
// early after a later successful one scheduled its own reset.
var guardTimer: ReturnType<typeof setTimeout> | undefined;
// Set when /getupdates stopped answering with a real payload (e.g. everything comes back as
// the SPA's index.html): the cache may then hold shells nobody intended, so getfile serves
// network instead of trusting it. Session-scoped; the next worker start probes again.
let updatesUnavailable = false;

function samedomain(url: string | URL) {
	return new URL(url).origin === self.origin;
}

let enabled = "false";
let offline = false;
function toPathNoDefault(url: string) {
	const Url = new URL(url);
	let html: string | undefined = undefined;
	const path = Url.pathname;
	if (path.startsWith("/channels")) {
		html = "./app";
	} else if (path.startsWith("/invite/") || path === "/invite") {
		html = "./invite";
	} else if (path.startsWith("/template/") || path === "/template") {
		html = "./template";
	} else if (path === "/") {
		html = "./index";
	}
	return html;
}
function toPath(url: string): string {
	const Url = new URL(url);
	return toPathNoDefault(url) || Url.pathname;
}
function cacheLookupKey(req: Request): string {
	const url = new URL(req.url);
	const path = toPath(req.url);
	if (path.endsWith(".css") || path.endsWith(".woff2")) {
		return url.pathname + url.search;
	}
	return path;
}
let fails = 0;
// After enough failed origin fetches the client counts as offline; 30 s later the flag clears
// lazily, so the next request probes the network again instead of staying offline forever.
const OFFLINE_PROBE_MS = 30_000;
let offlineSince = 0;
function isOffline() {
	if (offline && Date.now() - offlineSince > OFFLINE_PROBE_MS) {
		offline = false;
		offlineSince = 0;
	}
	return offline;
}
function markOffline() {
	offline = true;
	offlineSince = Date.now();
}
function registerFailure() {
	fails++;
	if (fails > 5) {
		markOffline();
	}
}
function registerSuccess() {
	fails = 0;
	offline = false;
	offlineSince = 0;
}
async function getfile(req: Request): Promise<Response> {
	checkCache();
	if (!samedomain(req.url) || enabled === "false" || (enabled === "offlineOnly" && !isOffline())) {
		let response: Response;
		try {
			response = await fetch(req.clone());
		} catch (e) {
			// Only origin failures count toward offline: a flaky third-party host must not
			// flip the worker into cache-serving for the origin it knows nothing about.
			if (samedomain(req.url)) {
				registerFailure();
			}
			// An "online" offlineOnly client dying without its cached shell serves nobody:
			// last resort is the very cache the flag says not to trust.
			if (samedomain(req.url) && enabled === "offlineOnly") {
				const cached = await caches.match(cacheLookupKey(req));
				if (cached) {
					return cached;
				}
			}
			throw e;
		}
		if (samedomain(req.url)) {
			if (response.ok) {
				registerSuccess();
			} else {
				registerFailure();
			}
			if (enabled === "offlineOnly" && response.ok) {
				putInCache(toPath(req.url), response.clone());
			}
		}
		return response;
	}

	const path = toPath(req.url);
	if (path === "/getupdates" || path === "/files.json") {
		const response = await fetch(new Request(req, {cache: "no-store"}));
		return response;
	}
	const cacheKey = cacheLookupKey(req);
	if (!updatesUnavailable) {
		const responseFromCache = await caches.match(cacheKey);
		if (responseFromCache) {
			return responseFromCache;
		}
	}
	try {
		const responseFromNetwork = await fetch(req.url);
		if (responseFromNetwork.ok) {
			await putInCache(cacheKey, responseFromNetwork.clone());
		}
		return responseFromNetwork;
	} catch (e) {
		console.error(e);
		// The cache is tried first even here, as a last resort — updatesUnavailable only
		// stops the normal cache-first path above. Only when that fails too: a 503 naming
		// the failure (an empty 200 would be an empty module served offline).
		const cached = await caches.match(cacheKey).catch(() => undefined);
		if (cached) return cached;
		return new Response("service worker: origin fetch failed", {status: 503});
	}
}
const promURLMap = new Map<string, (url: string) => void>();
async function refreshUrl(url: URL, port: MessagePort): Promise<string> {
	port.postMessage({
		code: "refreshURL",
		url: url.toString(),
	});
	return new Promise((res) => promURLMap.set(url.toString(), res));
}
async function onFetch(e: Event) {
	const event = e as FetchEvent;
	const host = URL.canParse(event.request.url) && new URL(event.request.url).host;
	let req = event.request;

	const port = rMap.get(host || "");
	if (port) {
		const url = new URL(event.request.url);
		const ignore = ["/api", "/_spacebar"].find((_) => url.pathname.startsWith(_));
		if (!ignore) {
			const expired =
				url.searchParams.get("ex") &&
				Number.parseInt(url.searchParams.get("ex") || "", 16) < Date.now() - 5000;
			event.respondWith(
				new Promise(async (res) => {
					try {
						const cached = await getFromCache(url);
						if (cached) {
							res(cached);
							return;
						}
						if (expired) {
							req = await Promise.race<Request>([
								new Promise(async (res) => res(new Request(await refreshUrl(url, port), req))),
								new Promise((res) => setTimeout(() => res(req), 5000)),
							]);
						}
						const f = await fetch(req);
						res(f);
						putInCache(url, f.clone());
					} catch (e) {
						// An unsettled respondWith promise leaves the page's fetch hanging forever
						// (offline CDN images): settle it as a network error instead.
						console.error(e);
						res(Response.error());
					}
				}),
			);
			return;
		}
	}

	if (apiHosts?.has(host || "")) {
		try {
			const response = await fetch(req.clone());
			try {
				event.respondWith(response.clone());
			} catch {}

			const json = await response.json();
			if (json._trace) {
				sendAll({
					code: "trace",
					trace: json._trace,
				});
			}
		} catch (e) {
			console.error(e);
			//Wasn't meant to be ig lol
		}
		return;
	}

	if (req.method === "POST") {
		return;
	}
	if (new URL(req.url).pathname.startsWith("/api/")) {
		return;
	}
	try {
		event.respondWith(getfile(req));
	} catch (e) {
		console.error(e);
	}
}
if (!notificationsOnly) self.addEventListener("fetch", onFetch);
// A notifications-only worker (it holds no caches), and a caching one leaving the default mode,
// take over at once instead of waiting until every window the old worker controls has closed.
self.addEventListener("install", () => {
	const sw = self as unknown as ServiceWorkerGlobalScope;
	const active = sw.registration.active;
	if (
		notificationsOnly ||
		(active && new URL(active.scriptURL).searchParams.has("notifications"))
	) {
		sw.skipWaiting();
	}
});
// A tap goes to the app's window, which runs the handler it kept under the tag
// (notificationHandler.ts), or opens the channel itself; with no window left, the
// notification's channel opens in a new one.
self.addEventListener("notificationclick", (e) => {
	const event = e as NotificationEvent;
	const sw = self as unknown as ServiceWorkerGlobalScope;
	event.notification.close();
	const {tag} = event.notification;
	const url: unknown = event.notification.data?.url;
	const channelId: unknown = event.notification.data?.channelId;
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({type: "window", includeUncontrolled: true});
			const app =
				windows.find((w) => new URL(w.url).pathname.startsWith("/channels")) ?? windows[0];
			if (app) {
				app.postMessage({code: "notificationClick", tag, channelId});
				await app.focus();
			} else if (typeof url === "string") {
				await sw.clients.openWindow(url);
			}
		})(),
	);
});
const ports = new Set<MessagePort>();
let dev = false;
let apiHosts: Set<string> | void;
const rMap = new Map<string, MessagePort>();
function listenToPort(port: MessagePort) {
	function sendMessage(message: messageFrom) {
		port.postMessage(message);
	}
	port.onmessage = async (e) => {
		const data = e.data as messageTo;
		switch (data.code) {
			case "ping": {
				sendMessage({
					code: "pong",
					count: ports.size,
				});
				break;
			}
			case "close": {
				ports.delete(port);
				break;
			}
			case "replace": {
				//@ts-ignore-error Just the type or wrong or something
				self.skipWaiting();
				break;
			}
			case "CheckUpdate": {
				checkedrecently = false;
				if (!(await checkCache())) {
					sendMessage({
						code: "updates",
						updates: false,
					});
				}

				break;
			}
			case "isValid": {
				sendMessage({code: "isValid", url: data.url, valid: !!toPathNoDefault(data.url)});
				break;
			}
			case "isDev": {
				const refetch = !dev && data.dev;
				dev = data.dev;
				if (refetch) {
					getAllFiles();
				}
				break;
			}
			case "apiUrls": {
				if (data.hosts) {
					apiHosts = new Set(data.hosts);
				} else {
					apiHosts = undefined;
				}
				break;
			}
			case "canRefresh": {
				rMap.set(data.host, port);
				break;
			}
			case "refreshedUrl": {
				const res = promURLMap.get(data.oldurl);
				if (res) {
					res(data.url);
					promURLMap.delete(data.oldurl);
				}
			}
		}
	};
	port.addEventListener("close", () => {
		ports.delete(port);
	});
}
self.addEventListener("message", (message) => {
	const data = message.data;
	switch (data.code) {
		case "setMode":
			enabled = data.data;
			break;
		case "ForceClear":
			deleteoldcache();
			break;
		case "clearCdnCache":
			caches.delete("cdn");
			break;
		case "port": {
			const port = data.port as MessagePort;
			ports.add(port);
			listenToPort(port);
		}
	}
});
