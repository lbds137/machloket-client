import {afterAll, afterEach, expect, it, vi} from "vitest";

// invite.ts runs its page code when it is imported, and only on an /invite path. The account the
// page offers comes from localStorage, which Localuser reads when it loads, so the URL, storage
// and page elements are all set before the imports below.
const WELLKNOWN = "http://invite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "abc";
const GUILD_ID = "700";
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			ann: {
				uid: "ann",
				email: "ann@invite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://invite.test/gateway",
				},
			},
		},
		currentuser: "ann",
	}),
);

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
document.body.innerHTML = `<button id="AcceptInvite">Accept Invite</button>
	<div id="invitename"></div><div id="invitedescription"></div><div id="invitebody"></div>
	<div id="inviteimg"></div><div id="inviteBanner"></div>`;

// The invite's own details (GET) wait on `answerGet`: a test decides whether they load before the
// accept (POST) completes. Until a test answers, the GET stalls.
const gets: string[] = [];
const posts: string[] = [];
let answerGet!: (res: Response) => void;
const getReply = new Promise<Response>((resolve) => {
	answerGet = resolve;
});
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		if ((init?.method ?? "GET") === "POST") {
			posts.push(url);
			return new Response(JSON.stringify({code: CODE}), {
				status: 200,
				headers: {"Content-Type": "application/json"},
			});
		}
		gets.push(url);
		return getReply;
	}
	return realFetch(input, init);
}) as typeof fetch;

// Page errors nothing catches: the accept's success handler throws inside a .then, which the
// browser reports as an unhandled rejection; no alert or navigation shows the user anything.
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

const {pageNav, GUILD_WAIT_MS} = await import("./invite");

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** Clicks the page's accept and picks the account in the switcher. */
async function acceptAsAnn() {
	document.querySelectorAll(".accountSwitcher").forEach((e) => e.remove());
	sessionStorage.removeItem("currentuser");
	document.getElementById("AcceptInvite")!.click();
	// The account switcher opens: pick the account (its row resolves the switcher).
	await vi.waitFor(() => expect(document.querySelector(".accountSwitcher .switchtable")).not.toBeNull());
	(document.querySelector(".accountSwitcher .switchtable") as HTMLElement).click();
}

// The accept (POST) completes while the invite's details (GET) are still loading: the accept must
// not stall, and must not read an unset guild. It lands on the home page once the wait runs out.
it("an accept while the invite's details are still loading lands on the home page after the wait", async () => {
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {});
	await vi.waitFor(() => expect(gets).toHaveLength(1));
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});

	await acceptAsAnn();
	await vi.waitFor(() => expect(posts).toHaveLength(1));
	// The accept has stored the account and started its wait; only then can the wait run out.
	await vi.waitFor(() => expect(sessionStorage.getItem("currentuser")).not.toBeNull());
	expect(go).not.toHaveBeenCalled();
	vi.advanceTimersByTime(GUILD_WAIT_MS);

	await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/channels/@me"));
	expect(rejections).toEqual([]);
});

// The details load before the accept completes: the accept lands on the invite's guild.
it("an accept after the invite's details loaded lands on the invite's guild", async () => {
	const go = vi.spyOn(pageNav, "go").mockImplementation(() => {});
	answerGet(
		new Response(JSON.stringify({code: CODE, guild: {id: GUILD_ID, name: "Guild"}}), {
			headers: {"Content-Type": "application/json"},
		}),
	);
	await vi.waitFor(() => expect(document.getElementById("invitename")?.textContent).toBe("Guild"));

	await acceptAsAnn();

	await vi.waitFor(() => expect(go).toHaveBeenCalledWith(`/channels/${GUILD_ID}`));
	expect(rejections).toEqual([]);
});
