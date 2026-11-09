import {afterAll, expect, it, vi} from "vitest";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./invite.html?raw";

// The /invite page as served, before and after its page code runs. Whatever invite.html shows
// before then is untranslated (the page only knows the language once I18n loads, and the
// button's label only once the instance lookup says whether an account can join), so the first
// paint must carry no text of its own and no button. Setup as in inviteAcceptLabel.test.ts:
// URL and stored account before the imports.
const WELLKNOWN = "http://firstpaintinvite.test";
const API = WELLKNOWN + "/api/v9";
const CODE = "firstpaint";
const UID = "ann@firstpaintinvite.test" + WELLKNOWN;
history.replaceState(null, "", `/invite/${CODE}?instance=${encodeURIComponent(WELLKNOWN)}`);
localStorage.setItem(
	"userinfos",
	JSON.stringify({
		users: {
			[UID]: {
				email: "ann@firstpaintinvite.test",
				token: "tok",
				serverurls: {
					wellknown: WELLKNOWN,
					api: API,
					cdn: WELLKNOWN + "/cdn",
					gateway: "ws://firstpaintinvite.test/gateway",
				},
			},
		},
		currentuser: null,
	}),
);

await import("./localuser");
const {I18n} = await import("./i18n");
const page = new DOMParser().parseFromString(pageHtml as string, "text/html");
page.querySelectorAll("script").forEach((s) => s.remove());
document.body.innerHTML = page.body.innerHTML;

const button = () => document.getElementById("AcceptInvite")!;
const text = (id: string) => document.getElementById(id)!.textContent!.trim();
const firstPaint = {
	name: text("invitename"),
	description: text("invitedescription"),
	label: text("AcceptInvite"),
	buttonVisibility: getComputedStyle(button()).visibility,
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === `${API}/invites/${CODE}`) {
		return new Response(JSON.stringify({code: CODE, guild: {id: "700", name: "Guild"}}), {
			headers: {"Content-Type": "application/json"},
		});
	}
	return realFetch(input, init);
}) as typeof fetch;

afterAll(() => {
	globalThis.fetch = realFetch;
	localStorage.removeItem("userinfos");
});

await import("./invite");
await I18n.done;

it("paints no untranslated text and no button before the page code runs", () => {
	expect(firstPaint).toEqual({name: "", description: "", label: "", buttonVisibility: "hidden"});
});

it("shows the button, labelled, once the page code has picked the label", async () => {
	await vi.waitFor(() => expect(text("invitename")).toBe("Guild"));
	expect(text("AcceptInvite")).toBe(I18n.invite.acceptInvite());
	expect(getComputedStyle(button()).visibility).toBe("visible");
});
