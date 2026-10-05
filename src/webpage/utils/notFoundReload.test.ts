import {expect, it} from "vitest";
import {reloadIfWorkerServes, type NotFoundEnv} from "./notFoundReload";

function env(over: Partial<NotFoundEnv> = {}) {
	const stored = new Map<string, string>();
	const reloads: string[] = [];
	const e: NotFoundEnv = {
		url: "https://app.test/channels/1/2",
		hasWorker: () => true,
		isValid: async () => true,
		reload: () => reloads.push(e.url),
		storage: () => ({
			getItem: (k) => stored.get(k) ?? null,
			setItem: (k, v) => void stored.set(k, v),
			removeItem: (k) => void stored.delete(k),
		}),
		...over,
	};
	return {e, reloads};
}

it("reloads once when a worker serves the page (the control)", async () => {
	const {e, reloads} = env();
	await reloadIfWorkerServes(e);
	expect(reloads).toHaveLength(1);
});

it("doesn't reload again when the reloaded page 404s too (a worker that passes requests through)", async () => {
	const {e, reloads} = env();
	await reloadIfWorkerServes(e);
	// The reload lands on the 404 page again.
	await reloadIfWorkerServes(e);
	expect(reloads).toHaveLength(1);
});

it("stops waiting for a worker that never comes", async () => {
	const {e, reloads} = env({hasWorker: () => false});
	const outcome = await Promise.race([
		reloadIfWorkerServes(e, 300).then(() => "gave up"),
		new Promise((res) => setTimeout(() => res("still polling"), 1000)),
	]);
	expect(outcome).toBe("gave up");
	expect(reloads).toEqual([]);
});

it("waits for a worker still installing to become active before reloading", async () => {
	let active = false;
	setTimeout(() => (active = true), 300);
	const {e, reloads} = env({hasWorker: () => active});
	await reloadIfWorkerServes(e);
	expect(reloads).toHaveLength(1);
});

it("doesn't reload where storage is blocked (it couldn't keep the once-only mark)", async () => {
	const {e, reloads} = env({
		storage: () => {
			throw new DOMException("blocked", "SecurityError");
		},
	});
	await reloadIfWorkerServes(e);
	expect(reloads).toEqual([]);
});
