import {afterAll, expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored accounts and the page elements are set before the imports below (as in
// inviteAcceptQuotaFull.test.ts). Here the account was signed in for this session only: the
// full store holds no account, and the login page handed the list over in sessionStorage.
const WELLKNOWN = "http://sessioninvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "session";
const UID = "ann@sessioninvite.test" + WELLKNOWN;
const HANDOFF_KEY = "machloket.sessionAccounts";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));
sessionStorage.setItem(
	HANDOFF_KEY,
	JSON.stringify({
		users: {
			[UID]: {
				email: "ann@sessioninvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://sessioninvite.test/gateway",
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
const {loadAccountHandoff, readItem} = await import("./utils/storage/settingOverlay");
// The overlay loads the hand-off at its module load; load it again in case an earlier static
// import evaluated it before the hand-off above was set.
loadAccountHandoff();
mountServedPage(pageHtml);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		const body =
			(init?.method ?? "GET") === "POST"
				? {guild: {id: "700"}}
				: {code: CODE, guild: {id: "700", name: "Guild"}};
		return new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
	}
	return realFetch(input, init);
}) as typeof fetch;

afterAll(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
	localStorage.removeItem("userinfos");
	sessionStorage.removeItem("currentuser");
	sessionStorage.removeItem(HANDOFF_KEY);
});

const {pageNav} = await import("./invite");
await I18n.done;

it("accepting with a session-only account on a full store keeps the new default for the session and in the hand-off", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
	const realSetItem = Storage.prototype.setItem;
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
		if (this === localStorage && key === "userinfos") throw quota;
		return realSetItem.call(this, key, value);
	});
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {});
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));

	document.getElementById("AcceptInvite")!.click();
	await vi.waitFor(() =>
		expect(document.querySelector(".accountSwitcher .switchtable")).not.toBeNull(),
	);
	(document.querySelector(".accountSwitcher .switchtable") as HTMLElement).click();
	await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/channels/700"));

	// The refused write goes through the one account writer: this page's readers and the
	// hand-off the app boots from both see the account the join picked.
	expect(JSON.parse(readItem("userinfos")!).currentuser).toBe(UID);
	expect(JSON.parse(sessionStorage.getItem(HANDOFF_KEY)!).currentuser).toBe(UID);
});
