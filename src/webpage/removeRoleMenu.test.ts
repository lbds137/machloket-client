import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {Member} = await import("./member");
const {Search} = await import("./search");
const {I18n} = await import("./i18n");
await I18n.done;

it("Remove role doesn't offer @everyone, which every member holds", async () => {
	const role = (id: string, name: string) => ({id, name, canManage: () => true});
	const guild = {id: "1000"};
	const member = Object.create(Member.prototype);
	Object.defineProperty(member, "guild", {value: guild});
	Object.defineProperty(member, "roles", {
		value: [role("1000", "@everyone"), role("2001", "Helpers")],
	});
	let offered: string[] = [];
	vi.spyOn(Search.prototype, "find").mockImplementation(async function (this: {
		options: Map<string, unknown>;
	}) {
		offered = [...this.options.keys()];
		return undefined;
	});
	const button = (
		User.contextmenu as unknown as {
			buttons: {
				text?: unknown;
				onClick: (this: unknown, m: unknown, e: unknown) => Promise<void>;
			}[];
		}
	).buttons.find(
		(b) => typeof b.text === "function" && (b.text as () => string)() === I18n.user.removeRole(),
	)!;

	await button.onClick.call({}, member, new MouseEvent("contextmenu"));

	expect(offered).toEqual(["Helpers"]);
	vi.restoreAllMocks();
});
