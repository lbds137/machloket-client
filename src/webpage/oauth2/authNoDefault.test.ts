import {expect, it, vi} from "vitest";
import {mountServedPage} from "../test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./authorize.html?raw";

// auth.ts acts once, at its first import, on an /oauth2 path (as in authPage.test.ts). Here the
// link has no ?instance= and the list has no instance to default to (each one unlisted below,
// before auth.ts reads the default): there is no instance to add the bot on.
history.replaceState(null, "", "/oauth2/authorize?client_id=9");
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("../localuser");
const {I18n} = await import("../i18n");
const {instancefetch, getInstances, getDefaultInstanceUrl} = await import("../utils/utils");
mountServedPage(pageHtml);
await instancefetch;
for (const instance of getInstances()) instance.display = false;
const noDefault = getDefaultInstanceUrl();
const rejections: unknown[] = [];
window.addEventListener("unhandledrejection", (e) => {
	rejections.push(e.reason);
	e.preventDefault();
});

// auth.ts awaits at its top level; with no instance it used to throw there, rejecting its import.
await import("./auth").catch((err) => rejections.push(err));
await I18n.done;

it("a bot invite with no instance to use says so instead of failing to load", async () => {
	expect(noDefault).toBeUndefined();
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	// Nothing was unreachable: the client has no instance at all (a deploy problem).
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		I18n.noInstanceConfigured(),
	);
	expect(document.getElementById("invitename")?.textContent).toBe(I18n.invite.botHeading());
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});
