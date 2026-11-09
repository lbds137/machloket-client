import {afterAll, expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// invite.ts runs its page code when it is imported, and only on an /invite path; the URL, the
// stored account and the page elements are set before the imports below (as in
// inviteAcceptOffline.test.ts).
const WELLKNOWN = "http://landinginvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "joins";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			ann: {
				uid: "ann",
				email: "ann@landinginvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://landinginvite.test/gateway",
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

// The invite's details load and the accept (POST) succeeds; the landing is what throws.
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
	localStorage.removeItem("userinfos");
	vi.restoreAllMocks();
});

const {pageNav} = await import("./invite");
await I18n.done;

it("a throw while landing after a successful accept is logged, not left unhandled or alerted as offline", async () => {
	const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const boom = new Error("landing boom");
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {
		throw boom;
	});
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));

	document.getElementById("AcceptInvite")!.click();
	await vi.waitFor(() =>
		expect(document.querySelector(".accountSwitcher .switchtable")).not.toBeNull(),
	);
	(document.querySelector(".accountSwitcher .switchtable") as HTMLElement).click();
	await vi.waitFor(() => expect(posts).toHaveLength(1));
	await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/channels/700"));
	// unhandledrejection fires a task after the rejection: wait past it before reading.
	await new Promise((resolve) => setTimeout(resolve, 20));

	expect(rejections).toEqual([]);
	expect(errorSpy).toHaveBeenCalledWith(boom);
	expect(alert).not.toHaveBeenCalledWith(I18n.requestFailed("offline"));
	// The join went through, so the user is told that, and how to get there (owner ruling 11-08).
	expect(I18n.invite.joinedNotOpened()).toBe(
		"You joined, but the server didn't open. Tap Accept again to go there.",
	);
	expect(alert).toHaveBeenCalledWith(I18n.invite.joinedNotOpened());
});
