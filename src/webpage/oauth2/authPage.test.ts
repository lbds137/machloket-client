import {afterEach, expect, it, vi} from "vitest";
import {addInstance} from "../test/setup";

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
	const body = document.createElement("div");
	body.id = "invitebody";
	body.innerHTML = `<img id="inviteimg" class="pfp" /><h1 id="invitename"></h1>
		<p id="invitedescription"></p><div id="permissions"><h1></h1></div>
		<button id="AcceptInvite"></button>`;
	document.body.append(body);
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
});
