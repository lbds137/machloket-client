/** What the 404 page needs from the browser; injectable so the policy can be tested. */
export interface NotFoundEnv {
	url: string;
	/**
	 * Whether a service worker is active (it may serve app routes the server 404s). A worker
	 * still installing doesn't take the reload's request yet.
	 */
	hasWorker(): boolean;
	/** Whether the worker would serve `url` as an app page. */
	isValid(url: string): Promise<boolean>;
	reload(): void;
	/** A getter: merely reaching sessionStorage throws where storage is blocked. */
	storage(): Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

const KEY = "notFoundReloaded";

/**
 * On the 404 page: if an active service worker serves this URL as an app page, reload once so
 * it can. A page that 404s again after that reload stays put (the worker passes the request
 * through, e.g. in a non-caching mode): reloading again would loop. Gives up waiting for an
 * active worker after `waitMs`, and doesn't reload where it can't keep the once-only mark.
 */
export async function reloadIfWorkerServes(env: NotFoundEnv, waitMs = 10000) {
	try {
		const storage = env.storage();
		if (storage.getItem(KEY) === env.url) {
			storage.removeItem(KEY);
			return;
		}
	} catch {
		return;
	}
	const until = Date.now() + waitMs;
	while (!env.hasWorker()) {
		if (Date.now() >= until) return;
		await new Promise((res) => setTimeout(res, 100));
	}
	if (!(await env.isValid(env.url))) return;
	try {
		env.storage().setItem(KEY, env.url);
	} catch {
		return;
	}
	env.reload();
}
