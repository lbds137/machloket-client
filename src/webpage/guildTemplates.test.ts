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

function guildWith(_button: ReturnType<typeof templateButton>) {
	return Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		// `info` and `headers` are getters on the prototype: they read through the owner.
		owner: {info: {api: API}, headers: {Authorization: "t"}},
	}) as unknown as {loadTemplates: (b: unknown) => Promise<void>};
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
});
