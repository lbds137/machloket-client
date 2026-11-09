import {expect, it, vi} from "vitest";
import {mountServedPage} from "../test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./authorize.html?raw";

// auth.ts acts once, at its first import, on an /oauth2 path (as in authPage.test.ts). Here the
// link names an instance nobody can find: no stored account, and no addInstance, so the lookup
// comes back empty.
const INSTANCE = "http://nowherebot.test";
history.replaceState(null, "", `/oauth2/authorize?client_id=9&instance=${INSTANCE}`);
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("../localuser");
const {I18n} = await import("../i18n");
mountServedPage(pageHtml);
const rejections: unknown[] = [];
window.addEventListener("unhandledrejection", (e) => {
	rejections.push(e.reason);
	e.preventDefault();
});

// auth.ts awaits at its top level; a failed lookup used to reject its import.
await import("./auth").catch((err) => rejections.push(err));
await I18n.done;

it("a bot invite to an instance that can't be found says so instead of leaving a blank page", async () => {
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		// The host only: the rest of the link's ?instance= is the link author's text.
		I18n.instanceUnreachable("nowherebot.test"),
	);
	expect(document.getElementById("invitename")?.textContent).toBe(I18n.invite.botHeading());
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});
