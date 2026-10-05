import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");

const KEY = "botConfigs_botcfg.test";

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem(KEY);
	document.querySelectorAll(".background").forEach((e) => e.remove());
});

function configButton() {
	const bot = Object.assign(Object.create(User.prototype), {
		id: "b1",
		bot: true,
		owner: {info: {api: "http://botcfg.test/api/v9"}},
	}) as InstanceType<typeof User>;
	const body = document.createElement("div");
	(
		bot as unknown as {addBotConfigButton(b: HTMLElement, close: () => void): void}
	).addBotConfigButton(body, () => {});
	return body.querySelector("button")!;
}

for (const stored of ["not json", "null", "[1]"]) {
	it(`the bot Config dialog opens over a corrupt stored value (${stored})`, () => {
		localStorage.setItem(KEY, stored);
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => {
			errors.push(e.error);
			e.preventDefault();
		};
		window.addEventListener("error", onError);

		configButton().click();
		window.removeEventListener("error", onError);

		expect(errors).toEqual([]);
		expect(document.querySelector(".background input[type=checkbox]")).not.toBeNull();
	});
}

it("the hide-tag choice is saved for that bot", () => {
	configButton().click();
	const box = document.querySelector<HTMLInputElement>(".background input[type=checkbox]")!;

	box.click();

	expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({b1: 1});
});
