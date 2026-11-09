import {afterAll, expect, it, vi} from "vitest";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteAcceptLandingThrow.test.ts).
const WELLKNOWN = "http://quotainvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "quota";
// Stored accounts are keyed by their uid, email + wellknown (Specialuser.uid, adduser): the key
// index.ts looks up from sessionStorage.
const UID = "ann@quotainvite.test" + WELLKNOWN;
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			[UID]: {
				email: "ann@quotainvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://quotainvite.test/gateway",
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
document.body.innerHTML = `<button id="AcceptInvite">Accept Invite</button>
	<div id="invitename"></div><div id="invitedescription"></div><div id="invitebody"></div>
	<div id="inviteimg"></div><div id="inviteBanner"></div>`;

const posts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		if ((init?.method ?? "GET") === "POST") {
			posts.push(url);
			return new Response(JSON.stringify({guild: {id: "700"}}), {
				headers: {"Content-Type": "application/json"},
			});
		}
		return new Response(JSON.stringify({code: CODE, guild: {id: "700", name: "Guild"}}), {
			headers: {"Content-Type": "application/json"},
		});
	}
	return realFetch(input, init);
}) as typeof fetch;

const rejections: unknown[] = [];
const onRejection = (e: PromiseRejectionEvent) => {
	rejections.push(e.reason);
	e.preventDefault();
};
window.addEventListener("unhandledrejection", onRejection);

afterAll(() => {
	globalThis.fetch = realFetch;
	window.removeEventListener("unhandledrejection", onRejection);
	vi.restoreAllMocks();
	localStorage.removeItem("userinfos");
	sessionStorage.removeItem("currentuser");
});

const {pageNav} = await import("./invite");
await I18n.done;

it("a full localStorage doesn't stop the landing: the account is already stored, and this tab's pick is in sessionStorage", async () => {
	const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const quota = new DOMException("The quota has been exceeded.", "QuotaExceededError");
	const realSetItem = Storage.prototype.setItem;
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
		if (this === localStorage && key === "userinfos") throw quota;
		return realSetItem.call(this, key, value);
	});
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {});
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));

	document.getElementById("AcceptInvite")!.click();
	await vi.waitFor(() => expect(document.querySelector(".accountSwitcher .switchtable")).not.toBeNull());
	(document.querySelector(".accountSwitcher .switchtable") as HTMLElement).click();
	await vi.waitFor(() => expect(posts).toHaveLength(1));
	// unhandledrejection fires a task after the rejection: wait past it before reading.
	await new Promise((resolve) => setTimeout(resolve, 20));

	// The app boots this tab's account from sessionStorage first (index.ts), so the landing goes
	// ahead; telling the user to accept again would loop on the same full storage.
	expect(sessionStorage.getItem("currentuser")).toBe(UID);
	expect(JSON.parse(localStorage.getItem("userinfos")!).users[UID]).toBeDefined();
	expect(go).toHaveBeenCalledWith("/channels/700");
	// The write did fail (the stub fired) and is logged.
	expect(errorSpy).toHaveBeenCalledWith(quota);
	expect(alert).not.toHaveBeenCalled();
	expect(rejections).toEqual([]);
});
