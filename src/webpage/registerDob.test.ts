import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {addInstance, captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
const {makeRegister} = await import("./register");
await I18n.done;

// S5b: the signup DOB field is keyed off the instance's /policies/instance/config —
// register_dateOfBirth_required === false hides it and drops it from the register
// payload; anything else (true, the key missing, the fetch failing) keeps today's
// shown-unrequired field. The server owns validation: its date_of_birth field errors
// must land on the field (BASE_TYPE_REQUIRED / DATE_OF_BIRTH_INVALID /
// DATE_OF_BIRTH_UNDERAGE differ only server-side; this pins the client path with one).

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

/** The newest dialog's DOB input, once the config answer has settled its visibility. */
function dobInput() {
	return newest<HTMLInputElement>('input[type="date"]');
}

async function fillAndSubmit() {
	newest<HTMLInputElement>('input[type="checkbox"]').checked = true;
	newest<HTMLButtonElement>("button.createAccount").click();
}

beforeEach(() => {
	// Not localStorage.clear(): utils.ts writes the `userinfos` defaults once, at load.
	localStorage.removeItem("instanceinfo");
});

afterEach(() => {
	document.body.replaceChildren();
});

it("an instance whose config rules the DOB out hides the field (it stays re-showable)", async () => {
	addInstance("http://nodob.test", 0);
	captureRequests("http://nodob.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: false}),
	);
	makeRegister(false, "", () => {});
	await pickInstance("http://nodob.test");

	await vi.waitUntil(() => {
		const input = dobInput();
		// Hidden, not removed: switching instances must be able to bring it back.
		return input !== undefined && !input.checkVisibility();
	}, {timeout: 2000});
});

it("an instance whose config rules the DOB out drops it from the register payload", async () => {
	addInstance("http://nodob2.test", 0);
	captureRequests("http://nodob2.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: false}),
	);
	const register = captureRequests("http://nodob2.test/api/v9/auth/register", () => {
		return new Promise<Response>(() => {});
	});
	makeRegister(false, "", () => {});
	await pickInstance("http://nodob2.test");
	// The hide must win the race with the submit: it gates what the payload carries.
	await vi.waitUntil(() => {
		const input = dobInput();
		return input !== undefined && !input.checkVisibility();
	}, {timeout: 2000});

	await fillAndSubmit();
	await vi.waitUntil(() => register.length > 0, {timeout: 2000});
	expect(Object.keys(register[0] as object)).not.toContain("date_of_birth");
});

it("a DOB-required instance keeps the field and sends its value", async () => {
	addInstance("http://dobreq.test", 0);
	captureRequests("http://dobreq.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: true}),
	);
	const register = captureRequests("http://dobreq.test/api/v9/auth/register", () => {
		return new Promise<Response>(() => {});
	});
	makeRegister(false, "", () => {});
	await pickInstance("http://dobreq.test");

	const input = dobInput();
	expect(input).toBeDefined();
	await vi.waitUntil(() => dobInput()?.checkVisibility() === true, {timeout: 2000});
	const fresh = dobInput()!;
	fresh.value = "2010-01-01";
	fresh.dispatchEvent(new Event("input"));

	await fillAndSubmit();
	await vi.waitUntil(() => register.length > 0, {timeout: 2000});
	expect((register[0] as {date_of_birth?: string}).date_of_birth).toBe("2010-01-01");
});

it("the server's date_of_birth field error shows on the field", async () => {
	addInstance("http://doberr.test", 0);
	captureRequests("http://doberr.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: true}),
	);
	captureRequests("http://doberr.test/api/v9/auth/register", () =>
		Response.json(
			{
				code: 50035,
				errors: {
					date_of_birth: {
						_errors: [
							{
								message: "You must be at least 13 years old",
								code: "DATE_OF_BIRTH_UNDERAGE",
							},
						],
					},
				},
			},
			{status: 400},
		),
	);
	makeRegister(false, "", () => {});
	await pickInstance("http://doberr.test");

	await fillAndSubmit();
	await vi.waitUntil(() => newest<HTMLElement>(".suberror") !== undefined, {timeout: 2000});
	expect(newest<HTMLElement>(".suberror")!.textContent).toBe(
		"You must be at least 13 years old",
	);
});

it("an instance without the config endpoint keeps today's shown field in the payload", async () => {
	addInstance("http://oldserver.test", 0);
	// No config capture: the shim 404s it, response.json() throws — the fallback path.
	const register = captureRequests("http://oldserver.test/api/v9/auth/register", () => {
		return new Promise<Response>(() => {});
	});
	makeRegister(false, "", () => {});
	await pickInstance("http://oldserver.test");

	const input = dobInput();
	expect(input).toBeDefined();
	await fillAndSubmit();
	await vi.waitUntil(() => register.length > 0, {timeout: 2000});
	expect(Object.keys(register[0] as object)).toContain("date_of_birth");
});

it("switching from a no-DOB instance to a DOB one re-gates the field", async () => {
	addInstance("http://switchnodob.test", 0);
	addInstance("http://switchdob.test", 0);
	captureRequests("http://switchnodob.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: false}),
	);
	captureRequests("http://switchdob.test/api/v9/policies/instance/config", () =>
		Response.json({register_dateOfBirth_required: true}),
	);
	const register = captureRequests("http://switchdob.test/api/v9/auth/register", () => {
		return new Promise<Response>(() => {});
	});
	makeRegister(false, "", () => {});
	await pickInstance("http://switchnodob.test");
	await vi.waitUntil(() => {
		const input = dobInput();
		return input !== undefined && !input.checkVisibility();
	}, {timeout: 2000});

	await pickInstance("http://switchdob.test");
	await vi.waitUntil(() => dobInput()?.checkVisibility() === true, {timeout: 2000});
	await fillAndSubmit();
	await vi.waitUntil(() => register.length > 0, {timeout: 2000});
	expect(Object.keys(register[0] as object)).toContain("date_of_birth");
});
