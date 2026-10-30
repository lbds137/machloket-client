import {afterEach, beforeEach, expect, it, onTestFinished, vi} from "vitest";
import {addInstance, captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
const {makeRegister} = await import("./register");
await I18n.done;

// tosLogic asks the picked instance's /ping for its terms-of-service page. An unreachable
// instance leaves the TOS area empty (pingResponse says so with null); an answer that isn't the
// ping's JSON must read the same way instead of throwing inside the fire-and-forget call.

function storedInstance() {
	return JSON.parse(localStorage.getItem("instanceinfo") ?? "null") as {api: string} | null;
}

/** What another test's dialog left behind is still in the document: use the newest. */
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

/** The newest dialog's terms-of-service area: the span beside the agree checkbox. */
const tosArea = () => newest<HTMLInputElement>('input[type="checkbox"]').previousElementSibling!;

beforeEach(() => {
	// Not localStorage.clear(): utils.ts writes the `userinfos` defaults once, at load.
	localStorage.removeItem("instanceinfo");
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/**
 * Registers on a fresh instance whose /ping answers `ping`, and settles once tosLogic has read
 * the answer; returns the page errors nothing caught meanwhile.
 */
async function pickWithPing(origin: string, ping: Response) {
	addInstance(origin);
	const parsed = vi.spyOn(ping, "json");
	captureRequests(origin + "/api/v9/ping", () => ping);
	const rejections: string[] = [];
	const onRejection = (e: PromiseRejectionEvent) => {
		rejections.push(String(e.reason));
		e.preventDefault();
	};
	window.addEventListener("unhandledrejection", onRejection);
	onTestFinished(() => window.removeEventListener("unhandledrejection", onRejection));

	makeRegister(false, "", () => {});
	await pickInstance(origin);
	await vi.waitFor(() => expect(parsed).toHaveBeenCalled());
	// A rejection lands a few tasks after the read; flush them before asserting.
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
	return rejections;
}

it("a ping answer that isn't JSON leaves the terms area empty instead of throwing", async () => {
	const rejections = await pickWithPing("http://tosbad.test", new Response("<html>"));

	expect(rejections).toEqual([]);
	expect(tosArea().textContent).toBe("");
});

it("a ping answer without an instance leaves the terms area empty instead of throwing", async () => {
	const rejections = await pickWithPing(
		"http://tosodd.test",
		Response.json({message: "Unauthorized"}),
	);

	expect(rejections).toEqual([]);
	expect(tosArea().textContent).toBe("");
});

it("a ping answer with no terms page says the instance has none (the control)", async () => {
	const rejections = await pickWithPing(
		"http://tosnone.test",
		Response.json({instance: {tosPage: null}}),
	);

	expect(rejections).toEqual([]);
	expect(tosArea().textContent).toBe(I18n.register.noTOS());
});
