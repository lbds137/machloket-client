import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "../test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {getApiUrlsV2} = await import("./utils");
const {Options, Dialog} = await import("../settings");

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

/** An instance at `site` whose well-known names `base` for its API, CDN and gateway. */
function instance(site: string, base: string) {
	captureRequests(site + "/.well-known/spacebar/client", () =>
		Response.json({
			api: {baseUrl: base},
			cdn: {baseUrl: base},
			gateway: {baseUrl: base.replace(/^http/, "ws")},
		}),
	);
}

it("accepting the URL correction moves the CDN to the page's scheme too", async () => {
	// A well-known that names loopback for a public site: the client offers to correct it.
	instance("http://site.test", "https://localhost:3001");
	captureRequests("http://site.test/api/v9/ping", () => Response.json({}));
	const buttons = vi.spyOn(Options.prototype, "addButtonInput");

	const pending = getApiUrlsV2("http://site.test");
	await vi.waitFor(() => expect(buttons).toHaveBeenCalled());
	// "Yes": use the site's own host and scheme.
	await (buttons.mock.calls[0][2] as () => Promise<void>)();

	const urls = await pending;
	expect(urls?.api).toBe("http://site.test/api/v9");
	expect(urls?.cdn).toBe("http://site.test/");
});

it("a host that merely contains 'localhost' isn't taken for loopback", async () => {
	instance("https://notlocalhost.example", "https://api.example");
	const shown = vi.spyOn(Dialog.prototype, "show");

	const urls = await getApiUrlsV2("https://notlocalhost.example");

	expect(shown).not.toHaveBeenCalled();
	expect(urls?.api).toBe("https://api.example/api/v9");
});

it("the corrected URLs keep the site's own port", async () => {
	instance("http://lan.test:8080", "https://localhost:3001");
	captureRequests("http://lan.test:8080/api/v9/ping", () => Response.json({}));
	const buttons = vi.spyOn(Options.prototype, "addButtonInput");

	const pending = getApiUrlsV2("http://lan.test:8080");
	await vi.waitFor(() => expect(buttons).toHaveBeenCalled());
	await (buttons.mock.calls[0][2] as () => Promise<void>)();

	expect((await pending)?.api).toBe("http://lan.test:8080/api/v9");
});
