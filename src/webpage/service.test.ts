import {afterEach, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before utils.
await import("./localuser");
const {SW} = await import("./utils/utils");

afterEach(async () => {
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
