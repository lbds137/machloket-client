import {expect, it} from "vitest";
import {mountServedPage} from "../test/servedPage";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./authorize.html?raw";

// auth.ts acts once, at its first import, on an /oauth2 path (as in authPage.test.ts). Signed in
// on the bot's instance, with ?permissions=: the page lists what the bot may do under its heading.
const WELLKNOWN = "http://permsbot.test";
const API = WELLKNOWN + "/api/v9";
const UID = "ann@permsbot.test" + WELLKNOWN;
history.replaceState(
	null,
	"",
	`/oauth2/authorize?client_id=9&permissions=8&instance=${encodeURIComponent(WELLKNOWN)}`,
);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			[UID]: {
				email: "ann@permsbot.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://permsbot.test/gateway",
				},
			},
		},
		currentuser: null,
	}),
);

await import("../localuser");
const {I18n} = await import("../i18n");
const {captureRequests} = await import("../test/setup");
// The real stylesheet, so the visibility checks see the page's own cascade.
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("../public/style.css?inline");
document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);
mountServedPage(pageHtml);

const permissions = document.getElementById("permissions")!;
// Before the bot's details load (and for good when they don't), the empty block takes no room.
const shownBefore = getComputedStyle(permissions).display;

captureRequests(API + "/oauth2/authorize/", () =>
	Response.json({
		guilds: [],
		user: {id: "1", username: "ann", avatar: "", discriminator: "0", public_flags: 0},
		application: {id: "9", name: "Helper", icon: null, description: "Helps out", summary: ""},
		bot: {
			id: "9",
			username: "Helper",
			avatar: null,
			avatar_decoration: null,
			discriminator: "0",
			public_flags: 0,
			bot: true,
		},
	}),
);
await import("./auth");
await I18n.done;

it("the permissions block shows only once it has the bot's permissions to list", async () => {
	expect(shownBefore).toBe("none");
	await expect.poll(() => getComputedStyle(permissions).display, {timeout: 5000}).not.toBe("none");
	expect(permissions.querySelector("h1")?.textContent).toBe(I18n.htmlPages.idpermissions());
	// permissions=8 is Administrator: one entry under the heading.
	expect(permissions.querySelectorAll(":scope > div").length).toBe(1);
});
