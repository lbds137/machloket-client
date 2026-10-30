import {afterEach, expect, it, onTestFinished} from "vitest";
import {addInstance, captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {setDefaults, instancefetch, getDefaultInstanceUrl} = await import("./utils/utils");
const {I18n} = await import("./i18n");
await I18n.done;

const before = location.href;
afterEach(() => {
	history.replaceState(history.state, "", before);
	for (const id of ["usetemplate", "templatename", "templatedescription"]) {
		document.getElementById(id)?.remove();
	}
});

let runs = 0;
/**
 * Opens /template/abc signed out and without ?instance=, the instance answering the template
 * request with `respond`. The page runs at import, so each call imports a fresh copy.
 */
async function openSignedOut(respond: () => Response | Promise<Response>) {
	const saved = localStorage.getItem("userinfos");
	localStorage.removeItem("userinfos");
	setDefaults();
	onTestFinished(() => {
		if (saved) localStorage.setItem("userinfos", saved);
	});
	for (const id of ["usetemplate", "templatename", "templatedescription"]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}
	// Whichever instance the build lists first is the default.
	await instancefetch;
	const origin = new URL(getDefaultInstanceUrl()!).origin;
	addInstance(origin);
	const asked = captureRequests(origin + "/api/v9/guilds/templates/abc", respond);
	history.replaceState(history.state, "", "/template/abc");
	await import(/* @vite-ignore */ "./templatePage.ts?run=" + ++runs);
	await expect.poll(() => asked.length, {timeout: 3000}).toBe(1);
	return {
		name: document.getElementById("templatename")!,
		description: document.getElementById("templatedescription")!,
		use: document.getElementById("usetemplate")!,
	};
}

it("a template link without ?instance= shows the template from the default instance", async () => {
	const {name} = await openSignedOut(() =>
		Response.json({name: "Book club", description: "Reading together"}),
	);
	await expect.poll(() => name.textContent).toContain("Book club");
});

it("an instance that wants a token for templates names no template rather than an undefined one", async () => {
	const {name} = await openSignedOut(() => Response.json({message: "Unauthorized"}, {status: 401}));
	await new Promise((res) => setTimeout(res, 100));
	expect(name.textContent).toBe("");
});

it("a template request that never arrived says the network failed in the page body", async () => {
	const {name, description} = await openSignedOut(() => Promise.reject(new TypeError("offline")));

	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("offline"));
	expect(name.textContent).toBe("");
});

it("a template answer that isn't JSON says why in the page body", async () => {
	const {name, description} = await openSignedOut(() => new Response("<html>"));

	// The body is consumed by the guarded json(), so refusalText can only say "HTTP 200".
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("HTTP 200"));
	expect(name.textContent).toBe("");
});

it("a template answer of the wrong shape says why in the page body", async () => {
	const {name, description} = await openSignedOut(() => Response.json({message: "x"}));

	// The body is consumed by the guarded json(), so refusalText can only say "HTTP 200".
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("HTTP 200"));
	expect(name.textContent).toBe("");
});
