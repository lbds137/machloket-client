import {afterAll, expect, it, vi} from "vitest";
import {addInstance} from "./test/setup";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored accounts and the page elements are set before the imports below (as in
// inviteAcceptLabel.test.ts). Here no stored account belongs to the invite's instance.
const WELLKNOWN = "http://noaccountinvite.test";
const CODE = "noacct";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));
// The page looks the instance up to find accounts by API url when none matches by well-known.
addInstance(WELLKNOWN);

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
document.body.innerHTML = `<button id="AcceptInvite"></button>
	<div id="invitename"></div><div id="invitedescription"></div><div id="invitebody"></div>
	<div id="inviteimg"></div><div id="inviteBanner"></div>`;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (new URL(url).pathname.endsWith(`/invites/${CODE}`)) {
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

it("with no account on the invite's instance, the button offers sign-up, not Accept Invite", async () => {
	// The label is set once the instance lookup resolves.
	await vi.waitFor(() => expect(document.getElementById("AcceptInvite")?.textContent).not.toBe(""));
	expect(document.getElementById("AcceptInvite")?.textContent).toBe(I18n.htmlPages.noAccount());
});
