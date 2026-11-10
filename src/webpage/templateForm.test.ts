import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Form, FormError, Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://templateform.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** The "create server from template" form of the dialog createGuild builds, its template field
 * holding `typed`. */
function templateForm(typed: string) {
	const addForm = vi.spyOn(Options.prototype, "addForm");
	// A second call in one test finds the spy of the first, and its forms.
	addForm.mockClear();
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, wellknown: "http://templateform.test"},
		headers: {Authorization: "tok"},
	});
	localuser.createGuild();
	const forms = addForm.mock.results.map((result) => result.value as InstanceType<typeof Form>);
	const form = forms.find((candidate) => candidate.names.has("template"))!;
	const field = form.names.get("template") as {value: string};
	field.value = typed;
	/** What submitting does with the field: the preprocessor's error, if it raises one. */
	const preprocess = () => {
		try {
			form.preprocessor({});
		} catch (e) {
			return e;
		}
		return undefined;
	};
	return {form, field, preprocess};
}

describe("create server from template", () => {
	it("refuses a code that climbs out of /guilds/templates/, and points the form nowhere", () => {
		const {form, field, preprocess} = templateForm("../x");

		const failure = preprocess() as InstanceType<typeof FormError>;

		expect(failure).toBeInstanceOf(FormError);
		expect(failure.message).toBe(I18n.guild.invalidTemplate());
		expect(failure.elem).toBe(field);
		expect(form.fetchURL).toBe("");
	});

	it("refuses a pasted link whose last segment is an encoded climb", () => {
		const {form, preprocess} = templateForm("https://example.org/t/%2e%2e%2fusers%2f%40me");

		expect(preprocess()).toBeInstanceOf(FormError);
		expect(form.fetchURL).toBe("");
	});

	it("builds the request URL from a typed code (positive control)", () => {
		const {form, preprocess} = templateForm("abc_123-X");

		expect(preprocess()).toBeUndefined();
		expect(form.fetchURL).toBe(API + "/guilds/templates/abc_123-X");
	});

	it("builds the request URL from a pasted link, a Discord one with its prefix (positive control)", () => {
		const own = templateForm("https://example.org/template/abc123");
		expect(own.preprocess()).toBeUndefined();
		expect(own.form.fetchURL).toBe(API + "/guilds/templates/abc123");

		const discord = templateForm("https://discord.new/abc123");
		expect(discord.preprocess()).toBeUndefined();
		expect(discord.form.fetchURL).toBe(API + "/guilds/templates/discord:abc123");
	});
});
