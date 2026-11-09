import {afterAll, expect, it} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// A bare /invite/CODE (no ?instance=, as typed by hand) opens on the deploy's default instance,
// the first usable listed one (as /template and /oauth2 do), not on an entry that happens to be
// named "Spacebar". Here every listed instance but "Other instance" is unlisted before invite.ts
// reads the default, and the stored account lives on that instance.
const WELLKNOWN = "http://other.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "bare";
history.replaceState(null, "", `/invite/${CODE}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			ann: {
				uid: "ann",
				email: "ann@other.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://other.test/gateway",
				},
			},
		},
		currentuser: "ann",
	}),
);

await import("./localuser");
const {I18n} = await import("./i18n");
const {captureRequests} = await import("./test/setup");
const {instancefetch, getInstances, getDefaultInstanceUrl} = await import("./utils/utils");
mountServedPage(pageHtml);
await instancefetch;
for (const instance of getInstances()) {
	if (instance.name !== "Other instance") instance.display = false;
}
const theDefault = getDefaultInstanceUrl();
captureRequests(
	`${API}/invites/${CODE}`,
	() =>
		new Response(JSON.stringify({code: CODE, guild: {id: "1", name: "Bare Guild"}}), {
			headers: {"Content-Type": "application/json"},
		}),
);
await import("./invite");
await I18n.done;

// localStorage is shared with the other test files.
afterAll(() => localStorage.removeItem("userinfos"));

it("a bare invite link opens on the default instance, where the stored account can accept it", async () => {
	expect(theDefault).toBe(WELLKNOWN);
	await expect.poll(() => document.getElementById("invitename")?.textContent).toBe("Bare Guild");
	const accept = document.getElementById("AcceptInvite")!;
	expect(accept.textContent).toBe(I18n.invite.acceptInvite());
	expect(getComputedStyle(accept).visibility).toBe("visible");
});
