import {afterAll, expect, it} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteGuildinfoRace.test.ts). As inviteRefused.test.ts, for the lookup that never answers.
const WELLKNOWN = "http://offlineinvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "unreached";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			ann: {
				uid: "ann",
				email: "ann@offlineinvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://offlineinvite.test/gateway",
				},
			},
		},
		currentuser: "ann",
	}),
);

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
const {captureRequests} = await import("./test/setup");
mountServedPage(pageHtml);

// The lookup never gets an answer (the network is down, or the instance stopped answering after
// discovery): fetch rejects, as the browser's does.
captureRequests(`${API}/invites/${CODE}`, () => Promise.reject(new TypeError("Failed to fetch")));
await import("./invite");
await I18n.done;

// localStorage is shared with the other test files.
afterAll(() => localStorage.removeItem("userinfos"));

it("an invite whose lookup gets no answer says so, and keeps its Accept", async () => {
	await expect
		.poll(() => document.getElementById("invitedescription")?.textContent)
		.toBe(I18n.requestFailed("offline"));
	// Nothing says the invite is dead, and no name came back: a generic heading.
	expect(document.getElementById("invitename")?.textContent).toBe(I18n.invite.heading());
	expect(document.getElementById("AcceptInvite")).not.toBeNull();
});
