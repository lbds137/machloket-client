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
