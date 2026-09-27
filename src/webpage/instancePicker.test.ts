import {beforeEach, describe, expect, it, vi} from "vitest";
import {acceptAuth, addDeadHost, addInstance} from "./test/setup";
import type {InstanceInfo, Specialuser} from "./utils/utils";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before settings.
await import("./localuser");
const {Dialog} = await import("./settings");
const {getDefaultInstanceUrl, getInstances, instancefetch} = await import("./utils/utils");
const {makeLogin} = await import("./login");
const {makeRegister} = await import("./register");
const {I18n} = await import("./i18n");

function storedInstance() {
	return JSON.parse(localStorage.getItem("instanceinfo") ?? "null") as InstanceInfo | null;
}

/** What another tab (or a stale check in old code) could have left in localStorage. */
const otherTab: InstanceInfo = {
	api: "http://other.test/api/v9",
	cdn: "http://other.test",
	gateway: "ws://other.test",
	wellknown: "http://other.test",
	value: "http://other.test",
};

/** The newest match: earlier tests leave their dialogs in the document. */
function newest<T extends Element>(selector: string) {
	const all = document.querySelectorAll<T>(selector);
	return all[all.length - 1];
}

/** Types `value` into the newest dialog's instance field and waits for it to be applied. */
async function pickInstance(value: string) {
	const input = newest<HTMLInputElement>('input[list="instances"]');
	input.value = value;
	input.dispatchEvent(new KeyboardEvent("keyup"));
	await vi.waitUntil(() => storedInstance()?.api === value + "/api/v9", {timeout: 2000});
}

function pickerWithButton() {
	const onchange = vi.fn();
	const picker = new Dialog("").options.addInstancePicker(onchange, {instance: ""});
	const button = document.createElement("button");
	picker.giveButton(button);
	return {picker, onchange, button};
}

beforeEach(() => {
	// Not localStorage.clear(): utils.ts writes the `userinfos` defaults once, at load.
	localStorage.removeItem("instanceinfo");
});

describe("instance list", () => {
	it("reads instances.json and resolves {hostname} to the host serving the client", async () => {
		await instancefetch;

		expect(getInstances().map((instance) => instance.url)).toEqual([
			`https://${location.hostname}:8443`,
			`http://${location.hostname}:3001`,
			"http://other.test",
		]);
	});

	it("defaults to the first instance using the page's own scheme", async () => {
		// An https page can't call an http instance (mixed content), and the http page on the
		// Deck can't reach the tailnet https address.
		await instancefetch;

		expect(getDefaultInstanceUrl("https:")).toBe(`https://${location.hostname}:8443`);
		expect(getDefaultInstanceUrl("http:")).toBe(`http://${location.hostname}:3001`);
	});
});

describe("InstancePicker", () => {
	it("starts on the default instance, never on spacebar.chat", async () => {
		await instancefetch;
		const picker = new Dialog("").options.addInstancePicker(vi.fn(), {instance: ""});
		picker.generateHTML();

		expect(picker.input.value).toBe(`http://${location.hostname}:3001`);
	});

	it("stores the instance the user last picked when an earlier check answers later", async () => {
		addInstance("http://slow.test", 200);
		addInstance("http://fast.test", 0);
		const {picker, onchange} = pickerWithButton();

		picker.input.value = "http://slow.test";
		const slow = picker.validate();
		picker.input.value = "http://fast.test";
		const fast = picker.validate();
		await Promise.all([slow, fast]);

		expect(onchange).toHaveBeenCalledTimes(1);
		expect(onchange.mock.calls[0][0].api).toBe("http://fast.test/api/v9");
		expect(storedInstance()?.api).toBe("http://fast.test/api/v9");
	});

	it("keeps the button disabled when a stale valid check lands after an invalid pick", async () => {
		addInstance("http://slow-valid.test", 200);
		addDeadHost("http://fast-dead.test", 0);
		const {picker, onchange, button} = pickerWithButton();

		picker.input.value = "http://slow-valid.test";
		const slow = picker.validate();
		picker.input.value = "http://fast-dead.test";
		const fast = picker.validate();
		await Promise.all([slow, fast]);

		expect(button.disabled).toBe(true);
		expect(picker.verify.textContent).toBe(I18n.login.invalid());
		expect(onchange).not.toHaveBeenCalled();
	});

	it("enables the button when a stale invalid check lands after a valid pick", async () => {
		addDeadHost("http://slow-dead.test", 200);
		addInstance("http://fast-valid.test", 0);
		const {picker, onchange, button} = pickerWithButton();

		picker.input.value = "http://slow-dead.test";
		const slow = picker.validate();
		picker.input.value = "http://fast-valid.test";
		const fast = picker.validate();
		await Promise.all([slow, fast]);

		expect(button.disabled).toBe(false);
		expect(picker.verify.textContent).toBe(I18n.login.allGood());
		expect(onchange).toHaveBeenCalledTimes(1);
	});
});

describe("login", () => {
	it("saves the session against the instance it posted to, whatever localStorage says", async () => {
		// Row 9 of the client survey: a token from one instance was saved with another's URLs,
		// read back from localStorage (which a stale check, or another tab, can rewrite).
		addInstance("http://picked.test", 0);
		const auth = acceptAuth("http://picked.test", "login", "picked-token");
		auth.release();
		const loggedIn = new Promise<Specialuser>((res) => makeLogin(false, "", res));
		await pickInstance("http://picked.test");

		localStorage.setItem("instanceinfo", JSON.stringify(otherTab));
		newest<HTMLButtonElement>("button.createAccount").click();
		const user = await loggedIn;

		expect(user.token).toBe("picked-token");
		expect(user.serverurls.api).toBe("http://picked.test/api/v9");
	});

	it("saves the session against the instance it posted to when the pick changes mid-request", async () => {
		addInstance("http://first.test", 0);
		addInstance("http://second.test", 0);
		const auth = acceptAuth("http://first.test", "login", "first-token");
		const loggedIn = new Promise<Specialuser>((res) => makeLogin(false, "", res));
		await pickInstance("http://first.test");

		newest<HTMLButtonElement>("button.createAccount").click();
		await auth.requestSeen;
		await pickInstance("http://second.test");
		auth.release();
		const user = await loggedIn;

		expect(user.token).toBe("first-token");
		expect(user.serverurls.api).toBe("http://first.test/api/v9");
	});
});

describe("login, submitted twice", () => {
	it("saves each response against the instance its own request went to", async () => {
		addInstance("http://one.test", 0);
		addInstance("http://two.test", 0);
		const first = acceptAuth("http://one.test", "login", "one-token");
		const second = acceptAuth("http://two.test", "login", "two-token");
		const loggedIn = new Promise<Specialuser>((res) => makeLogin(false, "", res));
		await pickInstance("http://one.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		await first.requestSeen;

		await pickInstance("http://two.test");
		newest<HTMLButtonElement>("button.createAccount").click();
		await second.requestSeen;
		first.release();
		const user = await loggedIn;

		expect(user.token).toBe("one-token");
		expect(user.serverurls.api).toBe("http://one.test/api/v9");
	});
});

describe("register", () => {
	it("saves the new account against the instance it posted to", async () => {
		addInstance("http://register.test", 0);
		addInstance("http://elsewhere.test", 0);
		const auth = acceptAuth("http://register.test", "register", "new-token");
		const registered = new Promise<Specialuser>((res) => makeRegister(false, "", res));
		await pickInstance("http://register.test");
		newest<HTMLInputElement>('input[type="checkbox"]').checked = true;

		localStorage.setItem("instanceinfo", JSON.stringify(otherTab));
		newest<HTMLButtonElement>("button.createAccount").click();
		await auth.requestSeen;
		await pickInstance("http://elsewhere.test");
		auth.release();
		const user = await registered;

		expect(user.token).toBe("new-token");
		expect(user.serverurls.api).toBe("http://register.test/api/v9");
	});
});
