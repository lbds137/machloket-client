import {afterAll, expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteGuildinfoRace.test.ts).
const WELLKNOWN = "http://offlineinvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "gone";
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
mountServedPage(pageHtml);

// The invite's details load; the accept (POST) fails the way fetch does with no network.
const offline = new TypeError("Failed to fetch");
const posts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		if ((init?.method ?? "GET") === "POST") {
			posts.push(url);
			throw offline;
		}
		return new Response(JSON.stringify({code: CODE, guild: {id: "700", name: "Guild"}}), {
			headers: {"Content-Type": "application/json"},
		});
	}
	return realFetch(input, init);
}) as typeof fetch;

const rejections: string[] = [];
const onRejection = (e: PromiseRejectionEvent) => {
	rejections.push(String(e.reason));
	e.preventDefault();
};
window.addEventListener("unhandledrejection", onRejection);

afterAll(() => {
	globalThis.fetch = realFetch;
	window.removeEventListener("unhandledrejection", onRejection);
	localStorage.removeItem("userinfos");
	vi.restoreAllMocks();
});

const {pageNav} = await import("./invite");
await I18n.done;

it("an accept that can't reach the server says so, instead of failing silently", async () => {
	const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {});
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));

	document.getElementById("AcceptInvite")!.click();
	await vi.waitFor(() =>
		expect(document.querySelector(".accountSwitcher .switchtable")).not.toBeNull(),
	);
	(document.querySelector(".accountSwitcher .switchtable") as HTMLElement).click();
	await vi.waitFor(() => expect(posts).toHaveLength(1));

	await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(I18n.requestFailed("offline")));
	expect(errorSpy).toHaveBeenCalledWith(offline);
	expect(rejections).toEqual([]);
	expect(go).not.toHaveBeenCalled();
});
