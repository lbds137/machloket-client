import {afterEach, expect, it, onTestFinished, vi} from "vitest";
import {addInstance, captureRequests, drain} from "./test/setup";
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
const {setDefaults, instancefetch, getDefaultInstanceUrl, getInstances} =
	await import("./utils/utils");
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
function openSignedOut(respond: () => Response | Promise<Response>) {
	return openTemplate(respond, () => {
		localStorage.removeItem("userinfos");
		setDefaults();
	});
}

/** As openSignedOut, with one account stored on the default instance. */
function openSignedIn(respond: () => Response | Promise<Response>) {
	return openTemplate(respond, (wellknown) => {
		const origin = new URL(wellknown).origin;
		const email = "ann@templatepage.test";
		localStorage.setItem(
			"userinfos",
			JSON.stringify({
				users: {
					[email + wellknown]: {
						email,
						token: "tok",
						serverurls: {
							wellknown,
							api: origin + "/api/v9",
							cdn: origin + "/cdn",
							gateway: "ws://templatepage.test/gateway",
						},
					},
				},
				currentuser: null,
			}),
		);
	});
}

async function openTemplate(
	respond: () => Response | Promise<Response>,
	storeAccounts: (defaultInstance: string) => void,
) {
	const saved = localStorage.getItem("userinfos");
	onTestFinished(() => {
		if (saved) localStorage.setItem("userinfos", saved);
		else localStorage.removeItem("userinfos");
	});
	document.body.append(document.importNode(servedCard(), true));
	// Whichever instance the build lists first is the default.
	await instancefetch;
	storeAccounts(getDefaultInstanceUrl()!);
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
	// The host only: the rest of the link's ?instance= is the link author's text.
	await expect
		.poll(() => description.textContent, {timeout: 5000})
		.toBe(I18n.instanceUnreachable("nowheretemplate.test"));
	expect(document.getElementById("templatename")!.textContent).toBe(I18n.templateHeading());
	expect(getComputedStyle(document.getElementById("usetemplate")!).visibility).toBe("hidden");
	expect(rejections).toEqual([]);
});

it("an ?instance= that is no address puts none of its text on the page", async () => {
	document.body.append(document.importNode(servedCard(), true));
	// Whoever writes the link writes ?instance=: here a sentence posing as the page's own.
	const crafted = "Your account is locked. Call 555-0100 to restore it";
	history.replaceState(history.state, "", "/template/abc?instance=" + encodeURIComponent(crafted));
	await import(/* @vite-ignore */ "./templatePage.ts?run=" + ++runs);

	const description = document.getElementById("templatedescription")!;
	await expect
		.poll(() => description.textContent, {timeout: 5000})
		.toBe(I18n.instanceUnreachableUnnamed());
	expect(document.getElementById("templatename")!.textContent).toBe(I18n.templateHeading());
	expect(getComputedStyle(document.getElementById("usetemplate")!).visibility).toBe("hidden");
});

it("a template link without ?instance= shows the template from the default instance", async () => {
	const {name} = await openSignedOut(() =>
		Response.json({name: "Book club", description: "Reading together"}),
	);
	await expect.poll(() => name.textContent).toContain("Book club");
});

it("an instance that wants a token for templates names no template rather than an undefined one", async () => {
	const {name, description} = await openSignedOut(() =>
		Response.json({message: "Unauthorized"}, {status: 401}),
	);
	// A generic heading, not an untitled card; signed out, the refusal is expected, so no reason.
	await expect.poll(() => name.textContent).toBe(I18n.templateHeading());
	expect(description.textContent).toBe("");
});

it("a template request that never arrived says the network failed in the page body", async () => {
	const {name, description} = await openSignedOut(() => Promise.reject(new TypeError("offline")));

	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("offline"));
	expect(name.textContent).toBe(I18n.templateHeading());
});

it("a template answer that isn't JSON says why in the page body", async () => {
	const {name, description} = await openSignedOut(() => new Response("<html>"));

	// Not JSON, so refusalText gives the status.
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("HTTP 200"));
	expect(name.textContent).toBe(I18n.templateHeading());
});

it("a template answer of the wrong shape says why in the page body", async () => {
	const {name, description} = await openSignedOut(() => Response.json({message: "x"}));

	// Cloning before json() leaves the body for refusalText to read the server's message.
	await expect.poll(() => description.textContent).toBe(I18n.requestFailed("x"));
	expect(name.textContent).toBe(I18n.templateHeading());
});

it("signed in, the template shows under its name and the button offers to use it", async () => {
	const {name, description, use} = await openSignedIn(() =>
		Response.json({name: "Book club", description: "Reading together"}),
	);

	await expect.poll(() => name.textContent).toBe(I18n.useTemplate("Book club"));
	expect(description.textContent).toBe("Reading together");
	expect(use.textContent).toBe(I18n.useTemplateButton());
});

it("signed in, a template the instance refuses says why", async () => {
	const {name, description} = await openSignedIn(() =>
		Response.json({code: 10057, message: "Unknown Guild Template"}, {status: 404}),
	);

	await expect
		.poll(() => description.textContent)
		.toBe(I18n.requestFailed("Unknown Guild Template"));
	expect(name.textContent).toBe(I18n.templateHeading());
});

it("with no ?instance= and no listed instance to default to, the page says so and offers nothing", async () => {
	document.body.append(document.importNode(servedCard(), true));
	await instancefetch;
	// Every listed instance unlisted for this test: getDefaultInstanceUrl has none to give.
	const listed = getInstances().filter((instance) => instance.display !== false);
	for (const instance of listed) instance.display = false;
	onTestFinished(() => {
		for (const instance of listed) instance.display = true;
	});
	expect(getDefaultInstanceUrl()).toBeUndefined();
	history.replaceState(history.state, "", "/template/abc");
	await import(/* @vite-ignore */ "./templatePage.ts?run=" + ++runs);

	const description = document.getElementById("templatedescription")!;
	// Nothing was unreachable: the client has no instance at all (a deploy problem).
	await expect.poll(() => description.textContent).toBe(I18n.noInstanceConfigured());
	expect(document.getElementById("templatename")!.textContent).toBe(I18n.templateHeading());
	expect(getComputedStyle(document.getElementById("usetemplate")!).visibility).toBe("hidden");
});

it("a template link whose path code climbs out of /guilds/templates/ sends no request there", async () => {
	const saved = localStorage.getItem("userinfos");
	onTestFinished(() => {
		vi.restoreAllMocks();
		if (saved) localStorage.setItem("userinfos", saved);
		else localStorage.removeItem("userinfos");
	});
	document.body.append(document.importNode(servedCard(), true));
	await instancefetch;
	localStorage.removeItem("userinfos");
	setDefaults();
	addInstance(new URL(getDefaultInstanceUrl()!).origin);
	// Calls through to the test network's fetch: nothing here reaches a real server.
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	// The path as a browser keeps it: %2F stays in the segment, so it's one "code".
	history.replaceState(history.state, "", "/template/..%2F..%2Fusers%2F%40me");
	await import(/* @vite-ignore */ "./templatePage.ts?run=" + ++runs);

	const title = document.getElementById("templatename")!;
	await expect.poll(() => title.textContent, {timeout: 5000}).toBe(I18n.templateHeading());
	await drain();

	const asked = fetchSpy.mock.calls.map(([input]) =>
		String(input instanceof Request ? input.url : input),
	);
	expect(asked.filter((url) => url.includes("/guilds/templates/"))).toEqual([]);
	// The page's failed state: the generic heading, the reason, and nothing to use.
	expect(document.getElementById("templatedescription")!.textContent).toBe(
		I18n.guild.invalidTemplate(),
	);
	expect(getComputedStyle(document.getElementById("usetemplate")!).visibility).toBe("hidden");
});
