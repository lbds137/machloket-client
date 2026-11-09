import {expect, it, vi} from "vitest";
import {mountServedPage} from "../test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./authorize.html?raw";

// As authNoInstance.test.ts, with an ?instance= that is no address: whoever writes the link
// writes it, here as a sentence posing as the page's own.
const CRAFTED = "Your account is locked. Call 555-0100 to restore it";
history.replaceState(
	null,
	"",
	`/oauth2/authorize?client_id=9&instance=${encodeURIComponent(CRAFTED)}`,
);
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("../localuser");
const {I18n} = await import("../i18n");
mountServedPage(pageHtml);
await import("./auth");
await I18n.done;

it("a bot invite's ?instance= that is no address puts none of its text on the page", async () => {
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		I18n.instanceUnreachableUnnamed(),
	);
	expect(document.body.textContent).not.toContain("555-0100");
});
