import {afterAll, expect, it} from "vitest";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteGuildinfoRace.test.ts).
const WELLKNOWN = "http://busyinvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "busy";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			ann: {
				uid: "ann",
				email: "ann@busyinvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://busyinvite.test/gateway",
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
document.body.innerHTML = `<button id="AcceptInvite">Accept Invite</button>
	<div id="invitename"></div><div id="invitedescription"></div><div id="invitebody"></div>
	<div id="inviteimg"></div><div id="inviteBanner"></div>`;

captureRequests(
	`${API}/invites/${CODE}`,
	() =>
		new Response(JSON.stringify({message: "Service Unavailable"}), {
			status: 503,
			headers: {"Content-Type": "application/json"},
		}),
);
await import("./invite");
await I18n.done;

// localStorage is shared with the other test files.
afterAll(() => localStorage.removeItem("userinfos"));

it("an invite the server couldn't look up says so, and keeps its Accept", async () => {
	await expect
		.poll(() => document.getElementById("invitedescription")?.textContent)
		.toBe(I18n.requestFailed("HTTP 503"));
	expect(document.getElementById("invitename")?.textContent).not.toBe(I18n.invite.notFound());
	expect(document.getElementById("AcceptInvite")).not.toBeNull();
});
