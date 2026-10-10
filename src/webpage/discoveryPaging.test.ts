import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

await import("./localuser");
const {Discovery} = await import("./discovery");
const {I18n} = await import("./i18n");

const API = "http://discover.test/api/v9";
const before = location.href;

afterEach(() => {
	history.replaceState(history.state, "", before);
	for (const id of ["channelTopic", "loadingdiv", "scrollWrap", "channels", "servertd", "serverName"]) {
		document.getElementById(id)?.remove();
	}
});

async function openDiscovery(page: {guilds: unknown[]; total: number}) {
	for (const id of ["channelTopic", "loadingdiv", "scrollWrap", "channels", "servertd", "serverName"]) {
		const element = document.createElement("div");
		element.id = id;
		document.body.append(element);
	}
	captureRequests(API + "/discoverable-guilds", () => Response.json(page));
	const localuser = {guildids: new Map(), pageTitle: () => {}, getSidePannel: () => {}};
	const discovery = Object.assign(Object.create(Discovery.prototype), {
		owner: {info: {api: API, cdn: "http://discover.test"}, headers: {}, localuser},
		context: {bindContextmenu: () => {}},
	}) as InstanceType<typeof Discovery>;
	await discovery.makeMenu();
	const scrollWrap = document.getElementById("scrollWrap")!;
	await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(page.guilds.length);
	return [...scrollWrap.querySelectorAll("button")].map((b) => b.textContent);
}

it("discovery offers no Next on the last page", async () => {
	const buttons = await openDiscovery({guilds: [{id: "g1", name: "One", description: ""}], total: 1});
	expect(buttons).not.toContain(I18n.search.next());
});

it("discovery offers Next while more servers follow (the control)", async () => {
	const guilds = Array.from({length: 50}, (_, i) => ({id: "g" + i, name: "S" + i, description: ""}));
	const buttons = await openDiscovery({guilds, total: 51});
	expect(buttons).toContain(I18n.search.next());
});

/** Opens discovery over a list endpoint answering with `respond`; returns the scroll area and the requests seen. */
async function mountDiscovery(respond: () => Response | Promise<Response>) {
	for (const id of ["channelTopic", "loadingdiv", "scrollWrap", "channels", "servertd", "serverName"]) {
		const element = document.createElement("div");
		element.id = id;
		document.body.append(element);
	}
	const asked = captureRequests(API + "/discoverable-guilds", respond);
	const localuser = {guildids: new Map(), pageTitle: () => {}, getSidePannel: () => {}};
	const discovery = Object.assign(Object.create(Discovery.prototype), {
		owner: {info: {api: API, cdn: "http://discover.test"}, headers: {}, localuser},
		context: {bindContextmenu: () => {}},
	}) as InstanceType<typeof Discovery>;
	await discovery.makeMenu();
	return {scrollWrap: document.getElementById("scrollWrap")!, asked};
}

const limited = () => Response.json({message: "rate limited", retry_after: 0.01}, {status: 429});

// RED: at HEAD the 429's body is read as the page, so nothing renders and the list is asked once.
it("discovery: a 429 waits its window, asks again once, and the list renders", async () => {
	let calls = 0;
	const page = {guilds: [{id: "g1", name: "One", description: ""}], total: 1};
	const {scrollWrap, asked} = await mountDiscovery(() => (calls++ === 0 ? limited() : Response.json(page)));

	await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(1);

	expect(asked).toHaveLength(2);
});

// RED: at HEAD a refused list is parsed as a page and throws out of render, leaving no error text.
it("discovery: a list that stays refused shows an error instead of a broken page", async () => {
	let calls = 0;
	const unhandled: string[] = [];
	const onUnhandled = (e: PromiseRejectionEvent) => {
		unhandled.push(String(e.reason));
		e.preventDefault();
	};
	window.addEventListener("unhandledrejection", onUnhandled);
	try {
		const {scrollWrap, asked} = await mountDiscovery(() =>
			calls++ === 0 ? limited() : new Response("oops", {status: 500}),
		);

		await expect.poll(() => scrollWrap.textContent).toContain(I18n.requestFailed("500"));

		expect(asked).toHaveLength(2);
		expect(scrollWrap.textContent).not.toContain(I18n.guild.loadingDiscovery());
		expect(scrollWrap.querySelectorAll(".discovery-guild")).toHaveLength(0);
		expect(unhandled).toEqual([]);
	} finally {
		window.removeEventListener("unhandledrejection", onUnhandled);
	}
});

const buttonLabels = (wrap: HTMLElement) => [...wrap.querySelectorAll("button")].map((b) => b.textContent);
const buttonLabelled = (wrap: HTMLElement, label: string) =>
	[...wrap.querySelectorAll("button")].find((b) => b.textContent === label)!;
const refused = () => new Response("oops", {status: 500});
const pageOf = (prefix: string, count: number, total: number) => ({
	guilds: Array.from({length: count}, (_, i) => ({id: prefix + i, name: prefix + i, description: ""})),
	total,
});

// RED: at HEAD a first-page failure leaves no buttons at all, so there is nothing to click.
it("discovery: a refused first page offers Try again, and a good answer then renders the list", async () => {
	let calls = 0;
	const page = {guilds: [{id: "g1", name: "One", description: ""}], total: 1};
	const {scrollWrap, asked} = await mountDiscovery(() => (calls++ === 0 ? refused() : Response.json(page)));

	await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
	expect(scrollWrap.textContent).toContain(I18n.requestFailed("500"));
	expect(buttonLabels(scrollWrap)).not.toContain(I18n.search.back());
	expect(asked).toHaveLength(1);

	buttonLabelled(scrollWrap, I18n.tryAgain()).click();

	await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(1);
	expect(asked).toHaveLength(2);
	expect(scrollWrap.textContent).not.toContain(I18n.requestFailed("500"));
});

// RED: at HEAD page 1's Next/Back survive a failed page 2 but are dead (their `switching`
// flag belongs to the render that built them), so Try again never exists and nothing re-fetches.
it("discovery: page 2 refused offers Back and Try again, and Try again asks for page 2 again", async () => {
	let calls = 0;
	const spy = vi.spyOn(globalThis, "fetch");
	try {
		const {scrollWrap, asked} = await mountDiscovery(() => {
			switch (calls++) {
				case 0:
					return Response.json(pageOf("a", 50, 120));
				case 1:
					return Response.json(pageOf("b", 50, 120));
				case 2:
					return refused();
				default:
					return Response.json(pageOf("c", 1, 120));
			}
		});
		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.search.next());
		buttonLabelled(scrollWrap, I18n.search.next()).click();
		await expect.poll(() => scrollWrap.textContent).toContain("b49");
		buttonLabelled(scrollWrap, I18n.search.next()).click();

		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		expect(buttonLabels(scrollWrap)).toContain(I18n.search.back());
		expect(buttonLabels(scrollWrap)).not.toContain(I18n.search.next());
		expect(asked).toHaveLength(3);

		buttonLabelled(scrollWrap, I18n.tryAgain()).click();

		await expect.poll(() => scrollWrap.textContent).toContain("c0");
		expect(asked).toHaveLength(4);
		const listCalls = spy.mock.calls
			.map(([input]) => String(input))
			.filter((url) => url.includes("/discoverable-guilds"));
		// The refused fetch (index 2) and its retry (index 3) ask for the same page.
		expect(listCalls[3]).toBe(listCalls[2]);
		expect(listCalls[3]).toContain("offset=100");
	} finally {
		spy.mockRestore();
	}
});

// RED: at HEAD a rejected list fetch (network down) throws out of render: no text, and the
// rejection floats.
it("discovery: a list fetch that rejects shows the failure and leaves no unhandled rejection", async () => {
	const unhandled: string[] = [];
	const onUnhandled = (e: PromiseRejectionEvent) => {
		unhandled.push(String(e.reason));
		e.preventDefault();
	};
	window.addEventListener("unhandledrejection", onUnhandled);
	try {
		const {scrollWrap} = await mountDiscovery(() => Promise.reject(new TypeError("offline")));

		await expect.poll(() => scrollWrap.textContent).toContain(I18n.requestFailed("offline"));

		expect(scrollWrap.textContent).not.toContain(I18n.guild.loadingDiscovery());
		expect(buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		// Give a floated rejection time to be reported.
		await new Promise((res) => setTimeout(res, 50));
		expect(unhandled).toEqual([]);
	} finally {
		window.removeEventListener("unhandledrejection", onUnhandled);
	}
});

/** Mounts on page 1 (50 of 120); later list calls are answered by `answer(call)`, call 1 being the first after page 1. */
async function openOnPage1(answer: (call: number) => Response) {
	let calls = 0;
	const mounted = await mountDiscovery(() => {
		const call = calls++;
		return call === 0 ? Response.json(pageOf("a", 50, 120)) : answer(call);
	});
	await expect.poll(() => buttonLabels(mounted.scrollWrap)).toContain(I18n.search.next());
	return mounted;
}

const listUrls = (spy: {mock: {calls: unknown[][]}}) =>
	spy.mock.calls.map(([input]) => String(input)).filter((url) => url.includes("/discoverable-guilds"));

// RED: the error state's Back is never clicked; a Back aimed at offset + limit, or no handler
// at all, passes every other test here.
it("discovery: Back works from the error state", async () => {
	const spy = vi.spyOn(globalThis, "fetch");
	try {
		const {scrollWrap, asked} = await openOnPage1((call) =>
			call === 2 ? refused() : Response.json(pageOf("b", 50, 120)),
		);
		buttonLabelled(scrollWrap, I18n.search.next()).click();
		await expect.poll(() => scrollWrap.textContent).toContain("b49");
		buttonLabelled(scrollWrap, I18n.search.next()).click();
		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		expect(buttonLabels(scrollWrap)).toContain(I18n.search.back());
		expect(asked).toHaveLength(3);

		buttonLabelled(scrollWrap, I18n.search.back()).click();

		await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(50);
		expect(scrollWrap.textContent).toContain("b49");
		expect(scrollWrap.textContent).not.toContain(I18n.requestFailed("500"));
		expect(asked).toHaveLength(4);
		const urls = listUrls(spy);
		expect(urls[2]).toContain("offset=100");
		expect(urls[3]).toContain("offset=50");
		expect(urls[3]).toBe(urls[1]);
	} finally {
		spy.mockRestore();
	}
});

// RED: a Try again that fails again is never exercised; buttons stranded after the second
// refusal would pass the single-failure test.
it("discovery: Try again can fail again, and then succeed", async () => {
	const spy = vi.spyOn(globalThis, "fetch");
	try {
		const {scrollWrap, asked} = await openOnPage1((call) =>
			call === 1 || call === 2 ? refused() : Response.json(pageOf("b", 50, 120)),
		);
		buttonLabelled(scrollWrap, I18n.search.next()).click();
		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		expect(asked).toHaveLength(2);

		buttonLabelled(scrollWrap, I18n.tryAgain()).click();
		await expect.poll(() => asked.length).toBe(3);
		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		expect(scrollWrap.textContent).toContain(I18n.requestFailed("500"));

		buttonLabelled(scrollWrap, I18n.tryAgain()).click();

		await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(50);
		expect(scrollWrap.textContent).not.toContain(I18n.requestFailed("500"));
		expect(asked).toHaveLength(4);
		const page2 = listUrls(spy).filter((url) => url.includes("offset=50"));
		expect(page2).toHaveLength(3);
		expect(new Set(page2).size).toBe(1);
	} finally {
		spy.mockRestore();
	}
});

// RED: the double click is never exercised; without `if (switching) return;` both clicks fetch.
it("discovery: a double click on Try again asks once", async () => {
	const spy = vi.spyOn(globalThis, "fetch");
	try {
		const {scrollWrap, asked} = await openOnPage1((call) =>
			call === 1 ? refused() : Response.json(pageOf("b", 50, 120)),
		);
		buttonLabelled(scrollWrap, I18n.search.next()).click();
		await expect.poll(() => buttonLabels(scrollWrap)).toContain(I18n.tryAgain());
		expect(asked).toHaveLength(2);

		const again = buttonLabelled(scrollWrap, I18n.tryAgain());
		again.click();
		again.click();

		await expect.poll(() => scrollWrap.querySelectorAll(".discovery-guild").length).toBe(50);
		// Let a wrongly issued second fetch land before counting.
		await new Promise((res) => setTimeout(res, 50));
		expect(asked).toHaveLength(3);
		expect(listUrls(spy).filter((url) => url.includes("offset=50"))).toHaveLength(2);
	} finally {
		spy.mockRestore();
	}
});
