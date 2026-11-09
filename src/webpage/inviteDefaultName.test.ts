import {expect, it, vi} from "vitest";
import {mountServedPage} from "./test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// As inviteNoInstance.test.ts, without ?instance=: invite.ts falls back to the listed name
// "Spacebar" (test/setup's list: https://spacebar.test), which nobody answers for here. The
// message names the listed instance's host, so the name index must be filled by then.
history.replaceState(null, "", "/invite/gone");
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("./localuser");
const {I18n} = await import("./i18n");
mountServedPage(pageHtml);
await import("./invite");
await I18n.done;

it("an invite without ?instance= whose listed default can't be found names that instance's host", async () => {
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		I18n.instanceUnreachable("spacebar.test"),
	);
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("hidden");
});
