import {afterEach, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before utils.
await import("./localuser");
const {SW} = await import("./utils/utils");

afterEach(async () => {
	// Undo the test-only /getupdates override first, so a worker the next test activates
	// fetches the plain fallback answer again.
	await fetch("/__test/sw-updates");
	for (const registration of await navigator.serviceWorker.getRegistrations()) {
		await registration.unregister();
	}
});

// First in the file: a full worker from an earlier test can still be writing its caches after
// its registration is gone.
it("registered for notifications only (the default mode, Android), it leaves the caches alone", async () => {
	for (const name of await caches.keys()) await caches.delete(name);
	await activated(await SW.register(true));
	await new Promise((res) => setTimeout(res, 300));
	expect(await caches.keys()).toEqual([]);
});

it("registers /service.js the way the app does, and it activates", async () => {
	const registration = await SW.register();
	const worker = registration.installing ?? registration.waiting ?? registration.active;
	expect(worker).toBeTruthy();
	if (worker!.state !== "activated") {
		await new Promise<void>((res, rej) => {
			worker!.addEventListener("statechange", () => {
				if (worker!.state === "activated") res();
				if (worker!.state === "redundant") rej(new Error("service worker became redundant"));
			});
		});
	}

	expect(registration.active?.scriptURL).toMatch(/\/service\.js$/);
});

it("in the default mode (no worker), a message to the worker returns instead of polling forever", async () => {
	const {getLocalSettings} = await import("./utils/storage/localSettings");
	const {ServiceWorkerMode} = await import("./utils/storage/localSettings");
	expect(getLocalSettings().serviceWorkerMode).toBe(ServiceWorkerMode.Unregistered);
	const port = SW.port;
	SW.port = undefined;
	try {
		const outcome = await Promise.race([
			SW.postMessage({code: "isDev", dev: false} as never).then(() => "returned"),
			new Promise((res) => setTimeout(() => res("still polling"), 500)),
		]);
		expect(outcome).toBe("returned");
	} finally {
		SW.port = port;
	}
});

async function activated(registration: ServiceWorkerRegistration) {
	const worker = registration.installing ?? registration.waiting ?? registration.active;
	if (worker!.state === "activated") return;
	await new Promise<void>((res, rej) => {
		worker!.addEventListener("statechange", () => {
			if (worker!.state === "activated") res();
			if (worker!.state === "redundant") rej(new Error("service worker became redundant"));
		});
	});
}

it("registered in full, it opens its caches (the control for the test above)", async () => {
	for (const name of await caches.keys()) await caches.delete(name);
	await activated(await SW.register());
	await new Promise((res) => setTimeout(res, 300));
	expect(await caches.keys()).toContain("save");
});

it("leaving the default mode, the caching worker takes over from the notifications-only one at once", async () => {
	await activated(await SW.register(true));
	// A window the notifications-only worker controls (the app reloaded since it registered).
	const frame = document.createElement("iframe");
	frame.src = "/robots.txt";
	const loaded = new Promise((res) => frame.addEventListener("load", res, {once: true}));
	document.body.append(frame);
	await loaded;
	try {
		expect(frame.contentWindow!.navigator.serviceWorker.controller).toBeTruthy();
		const registration = await SW.register();
		await expect
			.poll(() => registration.active?.scriptURL, {timeout: 3000})
			.toMatch(/\/service\.js$/);
	} finally {
		frame.remove();
	}
});

// --- U-sw1: service worker robustness ----------------------------------------------
// These drive the real worker through a connected port (the app's `port` message) and a
// controlled iframe, with /getupdates answered by the vitest-only middleware
// (/__test/sw-updates, vite.config.js).

/** `files` overrides what /files.json answers (a JSON manifest body, so a test's download
 * succeeds); `filesFail` destroys /files.json connections instead. Set alongside `body`:
 * the setter replaces the whole override, so a call without them clears them again — and
 * afterEach's unset call clears everything. */
async function setUpdates(
	body: string,
	type = "text/plain",
	status = 200,
	opts: {files?: string; filesFail?: boolean} = {},
) {
	const params = new URLSearchParams({body, type, status: String(status)});
	if (opts.files !== undefined) {
		params.set("files", opts.files);
	}
	if (opts.filesFail) {
		params.set("filesFail", "1");
	}
	const res = await fetch(`/__test/sw-updates?${params}`);
	expect(res.ok).toBe(true);
}

/** A full caching worker whose activate-time check has settled, with empty caches, plus the
 * controlled frame its controller is read from. The registering document isn't controlled
 * until a reload, but a client created after activation is (the takeover test above). */
async function cachingWorker(opts: {failingUpdates?: boolean} = {}): Promise<{
	controller: ServiceWorker;
	frame: HTMLIFrameElement;
}> {
	// The entry guard leaves checkedrecently true after any settled check (only a thrown
	// check resets it), so a test driving checks through requests activates the worker
	// against a failing /getupdates: its activate-time check throws, and the guard is open.
	if (opts.failingUpdates) {
		const res = await fetch("/__test/sw-updates?body=unreachable&fail=1");
		expect(res.ok).toBe(true);
	}
	const registration = await SW.register();
	await activated(registration);
	const frame = await controlledFrame();
	// The activate-time check fetched /getupdates and (when it saw a real payload) wrote a
	// marker; let it settle, then the test seeds its own cache state.
	await new Promise((res) => setTimeout(res, 2000));
	for (const name of await caches.keys()) await caches.delete(name);
	const controller = frame.contentWindow!.navigator.serviceWorker.controller;
	expect(controller).toBeTruthy();
	return {controller: controller!, frame};
}

function connectPort(controller: ServiceWorker) {
	const mc = new MessageChannel();
	const messages: {code: string; updates?: boolean}[] = [];
	controller.postMessage({code: "port", port: mc.port2}, [mc.port2]);
	mc.port1.onmessage = (e) => messages.push(e.data);
	return {port: mc.port1, messages};
}

async function seedMarker(text: string) {
	await (await caches.open("cache")).put("/getupdates", new Response(text));
}

async function markerText(): Promise<string | undefined> {
	return await (await (await caches.open("cache")).match("/getupdates"))?.text();
}

async function until(what: string, fn: () => boolean | Promise<boolean>, timeoutMs = 5000) {
	const start = Date.now();
	while (!(await fn())) {
		if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
		await new Promise((res) => setTimeout(res, 50));
	}
}

async function controlledFrame() {
	const frame = document.createElement("iframe");
	frame.src = "/robots.txt";
	const loaded = new Promise((res) => frame.addEventListener("load", res, {once: true}));
	document.body.append(frame);
	await loaded;
	expect(frame.contentWindow!.navigator.serviceWorker.controller).toBeTruthy();
	return frame;
}

it("collapses a burst of requests into one update check: one updates:true, one marker write", async () => {
	const {controller, frame} = await cachingWorker({failingUpdates: true});
	const {messages} = connectPort(controller);
	// The files override makes the update's download succeed (/robots.txt is served 200 by
	// the vitest server): since the no-marker-on-failed-download fix, a download whose
	// /files.json fails never reaches the marker write, and `until` below could not settle.
	await setUpdates("u-sw1-rev-a", "text/plain", 200, {files: JSON.stringify({"robots.txt": "x"})});
	await seedMarker("junk-marker");
	try {
		// Five same-origin fetches at once: each reaches getfile, whose checkCache call is
		// unawaited — the entry guard must collapse them to one check before any await.
		await Promise.all(
			Array.from({length: 5}, (_, i) => frame.contentWindow!.fetch(`/robots.txt?herd=${i}`)),
		);
		await until("the marker update", async () => (await markerText()) === "u-sw1-rev-a");
		// A moment for a duplicate broadcast to arrive, if the guard had let one through.
		await new Promise((res) => setTimeout(res, 300));
		expect(messages.filter((m) => m.code === "updates" && m.updates === true)).toHaveLength(1);
	} finally {
		frame.remove();
	}
}, 20000);

it("a CheckUpdate against an up-to-date marker answers updates:false", async () => {
	await setUpdates("junk-marker");
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	await seedMarker("junk-marker");
	try {
		port.postMessage({code: "CheckUpdate"});
		await until("the updates reply", () => messages.some((m) => m.code === "updates"));
		expect(messages.some((m) => m.code === "updates" && m.updates === true)).toBe(false);
		expect(messages.find((m) => m.code === "updates")!.updates).toBe(false);
	} finally {
		frame.remove();
	}
}, 20000);

// An index.html answer is the SPA fallback, not a new build: broadcasting it would pin a
// stale shell in every client's cache.
it("an index.html answer for /getupdates is not an update: the marker survives", async () => {
	await setUpdates("<html>fallback</html>", "text/html");
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	await seedMarker("junk-marker");
	try {
		port.postMessage({code: "CheckUpdate"});
		await new Promise((res) => setTimeout(res, 1000));
		expect(messages.some((m) => m.code === "updates" && m.updates === true)).toBe(false);
		expect(await markerText()).toBe("junk-marker");
	} finally {
		frame.remove();
	}
}, 20000);

// Regression coverage for the pre-existing non-ok guard: a failed probe changes nothing.
it("a non-ok /getupdates answer is not an update: the marker survives", async () => {
	await setUpdates("gone", "text/plain", 404);
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	await seedMarker("junk-marker");
	try {
		port.postMessage({code: "CheckUpdate"});
		await new Promise((res) => setTimeout(res, 1000));
		expect(messages.some((m) => m.code === "updates" && m.updates === true)).toBe(false);
		expect(await markerText()).toBe("junk-marker");
	} finally {
		frame.remove();
	}
}, 20000);

it("a failing CDN fetch routed through the worker rejects instead of hanging forever", async () => {
	const {controller, frame} = await cachingWorker();
	const {port} = connectPort(controller);
	port.postMessage({code: "canRefresh", host: "127.0.0.1:9"});
	try {
		// A closed port: connection-refused at once; no `ex` param, so no refresh race.
		// The timeout must lose to the fetch's own rejection; ~8s in the hanging world.
		const outcome = await Promise.race([
			frame.contentWindow!.fetch("http://127.0.0.1:9/x.png").then(
				() => "settled" as const,
				() => "rejected" as const,
			),
			new Promise((res) => setTimeout(() => res("timeout"), 8000)),
		]);
		expect(outcome).toBe("rejected");
	} finally {
		frame.remove();
	}
}, 20000);

it("with updates unavailable, the cached app shell is bypassed for network", async () => {
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	controller.postMessage({data: "enabled", code: "setMode"});
	try {
		// A server answering everything with index.html makes the worker treat updates as
		// unavailable; a stale shell seeded afterwards must then never be served.
		await setUpdates("<html>fallback</html>", "text/html");
		port.postMessage({code: "CheckUpdate"});
		await until("the updates reply", () => messages.some((m) => m.code === "updates"));
		await (
			await caches.open("cache")
		).put("/app", new Response("<html>stale shell</html>", {headers: {"x-usw1": "cache-hit"}}));
		const res = await frame.contentWindow!.fetch("/channels/test");
		expect(res.headers.get("x-usw1")).toBeNull();
	} finally {
		controller.postMessage({data: "false", code: "setMode"});
		frame.remove();
	}
}, 20000);

// Pins the no-marker-on-failed-download fix (U-sw1 round 1, M2): a download whose
// /files.json fails must neither write the marker nor broadcast the update — the marker is
// the "an update is ready" signal, and clients acting on it would find a half-empty cache.
it("a failed /files.json download writes no marker and broadcasts nothing", async () => {
	await setUpdates("round1-rev", "text/plain", 200, {filesFail: true});
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	await seedMarker("junk-marker");
	try {
		port.postMessage({code: "CheckUpdate"});
		await new Promise((res) => setTimeout(res, 1500));
		expect(messages.some((m) => m.code === "updates" && m.updates === true)).toBe(false);
		// The failed pass empties the cache by design (deleteoldcache runs before the
		// download), so the seed itself does not survive; the observable is that the new
		// revision was never written as the marker.
		expect(await markerText()).not.toBe("round1-rev");
	} finally {
		frame.remove();
	}
}, 20000);

// Pins the marker-last fix (U-sw1 round 1, M1): at the moment the updates broadcast arrives,
// the downloaded files must already be in the cache. Racy red before the fix (the download's
// puts are unawaited, so the broadcast can beat them); deterministic green after it.
it("the updates broadcast does not precede the download's cache writes", async () => {
	await setUpdates("round1-rev-b", "text/plain", 200, {files: JSON.stringify({"robots.txt": "x"})});
	const {controller, frame} = await cachingWorker();
	const {port, messages} = connectPort(controller);
	await seedMarker("junk-marker");
	try {
		port.postMessage({code: "CheckUpdate"});
		await until(
			"the updates:true broadcast",
			() => messages.some((m) => m.code === "updates" && m.updates === true),
			3000,
		);
		expect(await (await caches.open("cache")).match("/robots.txt")).not.toBeNull();
	} finally {
		frame.remove();
	}
}, 20000);
