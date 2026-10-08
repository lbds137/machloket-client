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
});
