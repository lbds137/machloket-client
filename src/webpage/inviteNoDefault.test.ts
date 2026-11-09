import {expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// As oauth2/authNoDefault.test.ts, for /invite: no ?instance= and no listed instance to default
// to (each one unlisted before invite.ts reads the default). Nothing was unreachable: the client
// has no instance at all, so the page says that, not "couldn't reach".
history.replaceState(null, "", "/invite/nowhere");
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("./localuser");
const {I18n} = await import("./i18n");
const {instancefetch, getInstances, getDefaultInstanceUrl} = await import("./utils/utils");
mountServedPage(pageHtml);
await instancefetch;
for (const instance of getInstances()) instance.display = false;
const noDefault = getDefaultInstanceUrl();
const rejections: unknown[] = [];
window.addEventListener("unhandledrejection", (e) => {
	rejections.push(e.reason);
	e.preventDefault();
});

await import("./invite");
await I18n.done;

it("an invite with no instance to open it on says so", async () => {
	expect(noDefault).toBeUndefined();
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		I18n.noInstanceConfigured(),
	);
	expect(document.getElementById("invitename")?.textContent).toBe(I18n.invite.heading());
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});
