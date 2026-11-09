import {afterEach, expect, it, vi} from "vitest";
import {addInstance} from "../test/setup";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./authorize.html?raw";

/** authorize.html's card as served (its script left out): what the page shows before its code runs. */
function servedCard(): HTMLElement {
	const page = new DOMParser().parseFromString(pageHtml as string, "text/html");
	return document.importNode(page.getElementById("invitebody")!, true);
}

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {I18n} = await import("../i18n");
await I18n.done;

const INSTANCE = "http://botpage.test";
const startPath = location.pathname + location.search;

afterEach(() => {
	history.replaceState(null, "", startPath);
	document.getElementById("invitebody")?.remove();
	vi.restoreAllMocks();
});

/** authorize.html's markup, then auth.ts on /oauth2/authorize: it acts once, at its first import. */
let opened = false;
async function openAuthorizePage() {
	if (opened) throw new Error("auth.ts acts only at its first import: one page run per test file");
	opened = true;
	document.body.append(servedCard());
	history.replaceState(null, "", `/oauth2/authorize?client_id=9&instance=${INSTANCE}`);
	await import("./auth");
}

it("with no account on the bot's instance, the button says to create one, in the app's language", async () => {
	addInstance(INSTANCE);
	vi.spyOn(localStorage, "getItem").mockImplementation((key) =>
		key === "userinfos" ? JSON.stringify({currentuser: null, users: {}}) : null,
	);
	vi.spyOn(I18n, "getTranslation").mockImplementation((key) => `⟨${key}⟩`);

	await openAuthorizePage();

	expect(document.getElementById("AcceptInvite")?.textContent).toBe("⟨invite.botNoAccount⟩");
	// Signed out, the bot's details never load: a generic heading, not an untitled card.
	expect(document.getElementById("invitename")?.textContent).toBe("⟨invite.botHeading⟩");
	expect(getComputedStyle(document.getElementById("AcceptInvite")!).visibility).toBe("visible");
});

it("the served page paints no untranslated text and no button before its code runs", () => {
	// The language loads with I18n, and the bot's name, description and permissions come from
	// the instance (signed out, never): anything the HTML shows first would stay English.
	document.body.append(servedCard());
	const shown = (sel: string) => document.querySelector(sel)!.textContent!.trim();
	expect({
		name: shown("#invitename"),
		description: shown("#invitedescription"),
		permissions: shown("#permissions"),
		label: shown("#AcceptInvite"),
		buttonVisibility: getComputedStyle(document.getElementById("AcceptInvite")!).visibility,
	}).toEqual({name: "", description: "", permissions: "", label: "", buttonVisibility: "hidden"});
});
