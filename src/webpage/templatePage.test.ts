import {afterEach, expect, it, onTestFinished} from "vitest";
import {addInstance, captureRequests} from "./test/setup";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import pageHtml from "./template.html?raw";

/** template.html's card as served (its script left out): what the page shows before its code runs. */
function servedCard(): HTMLElement {
	const page = new DOMParser().parseFromString(pageHtml as string, "text/html");
	return page.getElementById("invitebody")!;
}

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {setDefaults, instancefetch, getDefaultInstanceUrl} = await import("./utils/utils");
const {I18n} = await import("./i18n");
await I18n.done;

const before = location.href;
afterEach(() => {
	history.replaceState(history.state, "", before);
	document.getElementById("invitebody")?.remove();
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
	document.body.append(document.importNode(servedCard(), true));
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

it("the served page paints no untranslated text and no button before its code runs", () => {
	// The language loads with I18n, and the button's label depends on whether an account can use
	// the template; anything the HTML shows first would be English and possibly the wrong label.
	const card = servedCard();
	document.body.append(document.importNode(card, true));
	const shown = (id: string) => document.getElementById(id)!.textContent!.trim();
	expect({
		name: shown("templatename"),
		description: shown("templatedescription"),
		label: shown("usetemplate"),
		buttonVisibility: getComputedStyle(document.getElementById("usetemplate")!).visibility,
	}).toEqual({name: "", description: "", label: "", buttonVisibility: "hidden"});
});

it("signed out, the button offers an account rather than Use template, and shows once labelled", async () => {
	const {use} = await openSignedOut(() =>
		Response.json({name: "Book club", description: "Reading together"}),
	);
	// The label is set before the template request goes out (openSignedOut waits for that).
	expect(use.textContent).toBe(I18n.htmlPages.noAccount());
	expect(getComputedStyle(use).visibility).toBe("visible");
});

it("a template link to an instance that can't be found says so instead of a blank page", async () => {
	document.body.append(document.importNode(servedCard(), true));
	const rejections: unknown[] = [];
	const onRejection = (e: PromiseRejectionEvent) => {
		rejections.push(e.reason);
		e.preventDefault();
	};
	window.addEventListener("unhandledrejection", onRejection);
	onTestFinished(() => window.removeEventListener("unhandledrejection", onRejection));
	// No addInstance for it: the lookup comes back empty.
	const nowhere = "http://nowheretemplate.test";
	history.replaceState(history.state, "", "/template/abc?instance=" + encodeURIComponent(nowhere));
	await import(/* @vite-ignore */ "./templatePage.ts?run=" + ++runs);

	const description = document.getElementById("templatedescription")!;
	await expect
		.poll(() => description.textContent, {timeout: 5000})
		.toBe(I18n.instanceUnreachable(nowhere));
	expect(getComputedStyle(document.getElementById("usetemplate")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});

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

	// Not JSON, so refusalText gives the status.
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("HTTP 200"));
	expect(name.textContent).toBe("");
});

it("a template answer of the wrong shape says why in the page body", async () => {
	const {name, description} = await openSignedOut(() => Response.json({message: "x"}));

	// Cloning before json() leaves the body for refusalText to read the server's message.
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("x"));
	expect(name.textContent).toBe("");
});
