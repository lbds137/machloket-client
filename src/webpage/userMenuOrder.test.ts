import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {I18n} = await import("./i18n");
await I18n.done;

// setUpContextMenu() runs at import (the user.ts tail), so the shared user menu's row order
// is readable straight off the buttons array — the order makemenu() renders.
const menu = () => User.contextmenu as unknown as {buttons: {text: unknown}[]};

function rowIndexOf(label: string): number {
	return menu().buttons.findIndex(
		(b) => typeof b.text === "function" && (b.text as () => string)() === label,
	);
}

it("member menu keeps Discord's section order: moderation block, then roles, then copy-id", () => {
	const labels = {
		addRole: I18n.user.addRole(),
		removeRole: I18n.user.removeRole(),
		timeout: I18n.user.timeout(),
		unTimeout: I18n.user.unTimeout(),
		kick: I18n.user.kick(),
		ban: I18n.user.ban(),
		copyId: I18n.user.copyId(),
	};
	const row = Object.fromEntries(
		Object.entries(labels).map(([key, label]) => [key, rowIndexOf(label)]),
	) as Record<keyof typeof labels, number>;

	for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
		expect(row[key], `"${labels[key]}" row exists`).toBeGreaterThan(-1);
	}

	// Discord order per Fluxer's GuildMemberContextMenu (moderation group, then the
	// roles group, then copy id): strictly increasing moderation < roles < copy-id.
	const order = [
		row.timeout,
		row.unTimeout,
		row.kick,
		row.ban,
		row.addRole,
		row.removeRole,
		row.copyId,
	];
	expect(order, "moderation, then roles, then copy-id").toEqual(
		[...order].sort((a, b) => a - b),
	);
	// Section dividers: a separator part (no text) closes the moderation block and
	// opens the copy-id row.
	expect("text" in menu().buttons[row.ban + 1], "divider after the moderation block").toBe(false);
	expect("text" in menu().buttons[row.copyId - 1], "divider before copy-id").toBe(false);
});
