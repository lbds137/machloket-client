import {beforeEach, describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("../localuser");
const {I18n} = await import("../i18n");
await I18n.done;

let typediv: HTMLElement;

beforeEach(() => {
	document.querySelectorAll(".testComposer").forEach((el) => el.remove());
	const page = document.createElement("div");
	page.className = "testComposer";
	page.innerHTML = `<div id="typediv"><div id="realbox"></div><div id="typing"></div></div>`;
	document.body.append(page);
	typediv = page.querySelector("#typediv")!;
});

const status = () => typediv.querySelector(".commandStatus");

/** Just enough of a logged-in session for handleEvent's interaction path. */
function session(focused: object) {
	return Object.assign(Object.create(Localuser.prototype), {
		interNonceMap: new Map(),
		interactionNonces: new Set(),
		commandChannels: new Map(),
		commandNonceLabels: new Map(),
		interactionIdLabels: new Map(),
		channelids: new Map(),
		guilds: [],
		guildids: new Map([["@me", {channels: []}]]),
		generateFavicon: () => {},
		channelfocus: focused,
	}) as InstanceType<typeof Localuser>;
}
const event = (t: string, nonce: string, extra = {}) => ({
	op: 0,
	t,
	d: {id: "9", nonce, ...extra},
	s: 1,
});

describe("a slash command's progress above the composer", () => {
	it("shows it's being sent, then clears when the bot answers", async () => {
		const channel = {id: "200"};
		const user = session(channel);
		user.registerCommandNonce("77", channel as never);

		await user.handleEvent(event("INTERACTION_CREATE", "77") as never);
		expect(status()?.textContent).toBe(I18n.interactions.started());

		await user.handleEvent(event("INTERACTION_SUCCESS", "77") as never);
		expect(status()?.textContent ?? "").toBe("");
	});

	it("says the application did not respond when the server's timeout fires", async () => {
		const channel = {id: "200"};
		const user = session(channel);
		user.registerCommandNonce("77", channel as never);

		await user.handleEvent(event("INTERACTION_FAILURE", "77", {reason_code: 2}) as never);

		expect(status()?.textContent).toBe(I18n.interactions.noResponse());
		expect(status()?.classList.contains("failed")).toBe(true);
	});

	it("says the interaction failed for any other reason", async () => {
		const channel = {id: "200"};
		const user = session(channel);
		user.registerCommandNonce("77", channel as never);

		await user.handleEvent(event("INTERACTION_FAILURE", "77", {reason_code: 1}) as never);

		expect(status()?.textContent).toBe(I18n.interactions.failed());
	});

	it("clears its line when the answer comes after a switch to another channel", async () => {
		const channel = {id: "200"};
		const user = session(channel);
		user.registerCommandNonce("77", channel as never);
		await user.handleEvent(event("INTERACTION_CREATE", "77") as never);

		user.channelfocus = {id: "other"} as never;
		await user.handleEvent(event("INTERACTION_SUCCESS", "77") as never);

		expect(status()?.textContent ?? "").toBe("");
	});

	it("clears its line, rather than failing on screen, when it fails after a switch", async () => {
		const channel = {id: "200"};
		const user = session(channel);
		user.registerCommandNonce("77", channel as never);
		await user.handleEvent(event("INTERACTION_CREATE", "77") as never);

		user.channelfocus = {id: "other"} as never;
		await user.handleEvent(event("INTERACTION_FAILURE", "77", {reason_code: 2}) as never);

		expect(status()?.textContent ?? "").toBe("");
	});

	it("leaves another command's line alone", async () => {
		const here = {id: "200"};
		const user = session(here);
		user.registerCommandNonce("77", {id: "elsewhere"} as never);
		user.registerCommandNonce("88", here as never);
		await user.handleEvent(event("INTERACTION_CREATE", "88") as never);

		await user.handleEvent(event("INTERACTION_SUCCESS", "77") as never);

		expect(status()?.textContent).toBe(I18n.interactions.started());
	});

	it("stays quiet when the command's channel isn't the one on screen", async () => {
		const user = session({id: "other"});
		user.registerCommandNonce("77", {id: "200"} as never);

		await user.handleEvent(event("INTERACTION_FAILURE", "77", {reason_code: 2}) as never);

		expect(status()?.textContent ?? "").toBe("");
	});
});
