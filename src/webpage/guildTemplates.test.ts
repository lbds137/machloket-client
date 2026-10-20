import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");

const API = "http://tmpl.test";
const JSON_HEADERS = {"Content-Type": "application/json"};

/** The slice of a settings button the loader renders into. */
function templateButton() {
	return {
		addText: vi.fn(),
		addHTMLArea: vi.fn(),
		addButtonInput: vi.fn(),
	};
}

const CREATOR = "1553128655016763450";

/** A settings button that also opens sub-forms: a template's edit form is one. */
function templateButtonWithForms() {
	const form = {
		addText: vi.fn(),
		addHTMLArea: vi.fn(),
		addMDText: vi.fn(),
		addTextInput: vi.fn(() => ({value: "Renamed"})),
		addMDInput: vi.fn(),
		addPreprocessor: vi.fn(),
	};
	return {...templateButton(), addSubForm: vi.fn(() => form), form};
}

function guildWith(_button: ReturnType<typeof templateButton>, userMap = new Map()) {
	return Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		// `info` and `headers` are getters on the prototype: they read through the owner.
		owner: {info: {api: API, wellknown: "w.test"}, headers: {Authorization: "t"}, userMap},
	}) as unknown as {loadTemplates: (b: unknown) => Promise<void>};
}

function listOneTemplate() {
	captureRequests(
		`${API}/guilds/g1/templates`,
		() =>
			new Response(
				JSON.stringify([{code: "abc", name: "Abc", creator_id: CREATOR, usage_count: 3}]),
				{status: 200, headers: JSON_HEADERS},
			),
	);
}

/**
 * Loads the list, clicks the first template's Edit button, and lets its creator lookup settle.
 * `lookups` is the capture of the profile request, when the lookup makes one.
 */
async function openFirstEdit(
	guild: ReturnType<typeof guildWith>,
	button: ReturnType<typeof templateButtonWithForms>,
	lookups?: unknown[],
) {
	await guild.loadTemplates(button);
	const row = button.addHTMLArea.mock.calls[0][0] as HTMLElement;
	(row.querySelector("button") as HTMLButtonElement).click();
	if (lookups) await vi.waitFor(() => expect(lookups).toHaveLength(1));
	// A rejection lands a few tasks after the request is made; flush them before asserting.
	for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
}

describe("guild templates", () => {
	it("the template list renders newest first", async () => {
		const button = templateButton();
		const guild = guildWith(button);
		captureRequests(`${API}/guilds/g1/templates`, () =>
			new Response(
				JSON.stringify([
					{code: "old", name: "Old"},
					{code: "new", name: "New"},
				]),
				{status: 200, headers: JSON_HEADERS},
			),
		);

		await expect(guild.loadTemplates(button)).resolves.toBeUndefined();
		expect(button.addHTMLArea).toHaveBeenCalledTimes(2);
		expect(button.addHTMLArea.mock.calls[0][0].textContent).toContain("new (New)");
		expect(button.addHTMLArea.mock.calls[1][0].textContent).toContain("old (Old)");
	});

	it("a refusal lists nothing instead of throwing", async () => {
		const button = templateButton();
		const guild = guildWith(button);
		captureRequests(`${API}/guilds/g1/templates`, () =>
			new Response(JSON.stringify({message: "Missing permissions"}), {
				status: 403,
				headers: JSON_HEADERS,
			}),
		);

		await expect(guild.loadTemplates(button)).resolves.toBeUndefined();
		expect(button.addHTMLArea).not.toHaveBeenCalled();
	});

	it("a non-JSON refusal lists nothing instead of throwing", async () => {
		const button = templateButton();
		const guild = guildWith(button);
		captureRequests(`${API}/guilds/g1/templates`, () =>
			new Response("not json", {status: 403}),
		);

		await expect(guild.loadTemplates(button)).resolves.toBeUndefined();
		expect(button.addHTMLArea).not.toHaveBeenCalled();
	});

	it("a failed creator lookup drops only the created-by row, not the rest of the edit form", async () => {
		const unhandled = vi.fn();
		window.addEventListener("unhandledrejection", unhandled);
		try {
			const button = templateButtonWithForms();
			const guild = guildWith(button);
			listOneTemplate();
			const lookups = captureRequests(
				`${API}/users/${CREATOR}/profile`,
				() => new Response("boom", {status: 500}),
			);

			await openFirstEdit(guild, button, lookups);

			const {form} = button;
			expect(form.addText).toHaveBeenCalledTimes(1); // the use count; no created-by row
			expect(form.addTextInput).toHaveBeenCalledTimes(1);
			expect(form.addMDInput).toHaveBeenCalledTimes(1);
			expect(form.addPreprocessor).toHaveBeenCalledTimes(1);
			expect(form.addHTMLArea).not.toHaveBeenCalled();
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener("unhandledrejection", unhandled);
		}
	});

	it("a successful creator lookup still adds the created-by row", async () => {
		const button = templateButtonWithForms();
		const widget = document.createElement("span");
		const creator = {createWidget: vi.fn(() => widget)};
		const guild = guildWith(button, new Map([[CREATOR, creator]]));
		listOneTemplate();

		await openFirstEdit(guild, button);

		const {form} = button;
		expect(form.addText).toHaveBeenCalledTimes(2); // the created-by label and the use count
		expect(form.addHTMLArea).toHaveBeenCalledWith(widget);
	});
});
