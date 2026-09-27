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
