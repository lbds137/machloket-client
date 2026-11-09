import {expect, it, vi} from "vitest";

// invite.ts runs its page code when it is imported, and only on an /invite path (setup as in
// inviteNoAccountLabel.test.ts). Here the invite names an instance nobody can find: no stored
// account, and no addInstance, so the lookup comes back empty.
const WELLKNOWN = "http://nowhereinvite.test";
history.replaceState(null, "", `/invite/gone?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem("userinfos", JSON.stringify({users: {}, currentuser: null}));

await import("./localuser");
const {I18n} = await import("./i18n");
document.body.innerHTML = `<button id="AcceptInvite" style="visibility: hidden"></button>
	<div id="invitename"></div><div id="invitedescription"></div><div id="invitebody"></div>
	<div id="inviteimg"></div><div id="inviteBanner"></div>`;
const rejections: unknown[] = [];
window.addEventListener("unhandledrejection", (e) => {
	rejections.push(e.reason);
	e.preventDefault();
});

await import("./invite");
await I18n.done;

it("an invite to an instance that can't be found says so instead of leaving a blank page", async () => {
	await vi.waitFor(
		() => expect(document.getElementById("invitedescription")?.textContent).not.toBe(""),
		{timeout: 5000},
	);
	expect(document.getElementById("invitedescription")?.textContent).toBe(
		I18n.instanceUnreachable(WELLKNOWN),
	);
	// Nothing to accept with: the button stays hidden.
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});
