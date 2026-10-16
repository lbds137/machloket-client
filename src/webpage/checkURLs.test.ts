import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;
const {getapiurls} = await import("./utils/utils");

const WELLKNOWN = "http://typed.test";

/** Stubs the v2 well-known so checkURLs sees a loopback api behind a non-loopback
 * well-known: the mismatch opens its Yes/No dialog. */
function stubMixedOriginInstance() {
	captureRequests(`${WELLKNOWN}/.well-known/spacebar/client`, () =>
		Response.json({
			api: {baseUrl: "http://127.0.0.1:3001"},
			gateway: {baseUrl: "ws://127.0.0.1:3001"},
			cdn: {baseUrl: "http://127.0.0.1:3001"},
		}),
	);
}

/** checkURLs' dialog buttons carry their I18n labels; click the one named. */
function clickDialogButton(label: string) {
	const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
	if (!button) {
		throw new Error(
			`dialog button "${label}" not found; buttons in DOM: ` +
				[...document.querySelectorAll("button")].map((b) => JSON.stringify(b.textContent)).join(", "),
		);
	}
	button.click();
}

describe("checkURLs", () => {
	it("the No answer pings api/ping with its slash, not api+ping glued", async () => {
		stubMixedOriginInstance();
		const pings = captureRequests("http://127.0.0.1:3001/api/v9/ping");

		const result = getapiurls(WELLKNOWN);
		// The dialog is up as soon as the domains answer built the mismatch; take No.
		await vi.waitFor(() => clickDialogButton(I18n.no()));

		await expect(result).resolves.toMatchObject({api: "http://127.0.0.1:3001/api/v9"});
		expect(pings.length).toBe(1);
	});

	it("the Yes answer settles when the well-known's urls can't be rebuilt", async () => {
		// A well-known without a cdn base url: Yes rebuilds every url, and `new URL(undefined)` throws.
		captureRequests(`${WELLKNOWN}/.well-known/spacebar/client`, () =>
			Response.json({
				api: {baseUrl: "http://127.0.0.1:3001"},
				gateway: {baseUrl: "ws://127.0.0.1:3001"},
				cdn: {},
			}),
		);
		const result = getapiurls(WELLKNOWN);
		await vi.waitFor(() => clickDialogButton(I18n.yes()));

		const outcome = await Promise.race([
			result.then(() => "settled"),
			new Promise<string>((res) => setTimeout(() => res("hung"), 1500)),
		]);
		expect(outcome).toBe("settled");
	});

	it("the No answer's failed ping takes the dialog down", async () => {
		stubMixedOriginInstance();
		// Offline instance: the ping the No answer issues rejects.
		const pings = captureRequests("http://127.0.0.1:3001/api/v9/ping", () => {
			throw new Error("offline");
		});

		// getApiUrlsV2 swallows checkURLs' null (filed defect), so the promise's value
		// says nothing; the dialog coming down with the refusal is the observable.
		getapiurls(WELLKNOWN);
		await vi.waitFor(() => clickDialogButton(I18n.no()));

		expect(pings.length).toBe(1);
		await vi.waitFor(() => expect(document.querySelector(".background")).toBeNull());
	});

	it("the rewrite dialog opens above a caller's raised layer (login raises z-index 200)", async () => {
		// The login page raises its own dialog to inline z-index 200 before the check runs;
		// the rewrite dialog must end up at-or-above that AND after it in DOM order (equal
		// z-index paints later-on-top), or it opens hidden underneath and the check hangs.
		const loginLayer = document.createElement("div");
		loginLayer.className = "background";
		loginLayer.style.zIndex = "200";
		document.body.append(loginLayer);

		try {
			stubMixedOriginInstance();
			// The Yes answer rebuilds every url onto the well-known's own origin and pings that
			// origin to confirm it answers; stub it so the ping never leaves the test.
			const pings = captureRequests("http://typed.test/api/v9/ping", () => Response.json({}));

			const result = getapiurls(WELLKNOWN);

			let yes: HTMLButtonElement | undefined;
			await vi.waitFor(() => {
				yes = [...document.querySelectorAll("button")].find(
					(b) => b.textContent === I18n.yes(),
				);
				if (!yes) throw new Error("rewrite dialog button not in the DOM yet");
			});

			// The app stylesheet's .background sits at 102 (style.css) — below the raised
			// login layer — so the rewrite dialog must carry the raised level itself.
			const layer = yes!.closest(".background") as HTMLDivElement;
			expect(Number(layer.style.zIndex)).toBeGreaterThanOrEqual(
				Number(loginLayer.style.zIndex),
			);
			// Equal z-index paints later-on-top: the rewrite dialog must follow the login layer.
			expect(
				loginLayer.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();

			yes!.click();
			await expect(result).resolves.toMatchObject({api: "http://typed.test/api/v9"});
			expect(pings.length).toBe(1);
		} finally {
			loginLayer.remove();
			// removeAni completes on an animation the CSS-less test page never runs, so a
			// hiding dialog can sit in .removeElm; hard-remove leftovers to keep the page
			// clean for any later test.
			document.querySelectorAll(".background.removeElm").forEach((elm) => elm.remove());
		}
	});
});
