import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://delete.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** The delete confirmation for guild "Home", owned by a user with or without TOTP. */
function confirmDeleteOf(mfa: boolean) {
	const addForm = vi.spyOn(Options.prototype, "addForm");
	const hide = vi.spyOn(Dialog.prototype, "hide");
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		properties: {name: "Home"},
		headers: {Authorization: "t"},
		// `localuser` and `info` are getters on the prototype: they read through the owner.
		owner: Object.assign(Object.create(Localuser.prototype), {info: {api: API}, mfa_enabled: mfa}),
	});
	guild.confirmDelete();
	const form = addForm.mock.results[0].value as {
		submit(): Promise<void>;
		names: Map<string, {value: string}>;
	};
	return {form, hide};
}

/** Fills the form's fields by name ("" is the server-name check). */
function fill(form: {names: Map<string, {value: string}>}, fields: Record<string, string>) {
	for (const [name, value] of Object.entries(fields)) {
		const input = form.names.get(name);
		if (!input) throw new Error("no field " + name);
		input.value = value;
	}
}

it("an owner with two-factor on sends the code with the delete", async () => {
	await I18n.done;
	const sent = captureRequests(API + "/guilds/g1/delete", () => new Response(null, {status: 204}));
	const {form, hide} = confirmDeleteOf(true);
	fill(form, {"": "Home", code: "123456"});

	await form.submit();

	expect(sent).toEqual([{code: "123456"}]);
	expect(hide).toHaveBeenCalled();
});

it("a refused delete keeps the dialog open", async () => {
	await I18n.done;
	captureRequests(API + "/guilds/g1/delete", () =>
		Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400}),
	);
	const {form, hide} = confirmDeleteOf(true);
	fill(form, {"": "Home", code: "000000"});

	await form.submit();

	expect(hide).not.toHaveBeenCalled();
});

it("a mistyped server name sends nothing", async () => {
	await I18n.done;
	const sent = captureRequests(API + "/guilds/g1/delete", () => new Response(null, {status: 204}));
	const {form} = confirmDeleteOf(false);
	fill(form, {"": "Hoem"});

	await form.submit();

	expect(sent).toEqual([]);
});
