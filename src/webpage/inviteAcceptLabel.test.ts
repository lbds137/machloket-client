import {afterAll, expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteAcceptQuotaFull.test.ts).
const WELLKNOWN = "http://labelinvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "label";
// Stored accounts are keyed by their uid, email + wellknown (Specialuser.uid, adduser): the key
// index.ts looks up from sessionStorage.
const UID = "ann@labelinvite.test" + WELLKNOWN;
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			[UID]: {
				email: "ann@labelinvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://labelinvite.test/gateway",
				},
			},
		},
		currentuser: null,
	}),
);

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
mountServedPage(pageHtml);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		return new Response(JSON.stringify({code: CODE, guild: {id: "700", name: "Guild"}}), {
			headers: {"Content-Type": "application/json"},
		});
	}
	return realFetch(input, init);
}) as typeof fetch;

afterAll(() => {
	globalThis.fetch = realFetch;
	localStorage.removeItem("userinfos");
});

await import("./invite");
await I18n.done;

it("sets #AcceptInvite to I18n.invite.acceptInvite() when a joinable account exists", async () => {
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));
	expect(document.getElementById("AcceptInvite")?.textContent).toBe(I18n.invite.acceptInvite());
});
