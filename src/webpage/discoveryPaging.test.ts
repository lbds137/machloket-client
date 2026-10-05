import {afterEach, expect, it} from "vitest";
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
