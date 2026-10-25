import {expect} from "@playwright/test";
import {expectRequests, loginAndOpenChannel, test} from "./fixtures";

// The single-select (max_values 1) sheet, the twin of select-sheet.spec.ts's multi pins:
// fancySelect renders radio markers instead of checkboxes and NO footer at all (no count,
// no Apply) - the tap IS the answer, exactly as in Discord's select menus. The tap pins:
// the sheet closes, exactly one interaction goes out carrying that one value, and the box
// reads the choice back on reopen. The Discord-truth look of the radio sheet stays a walk
// verdict (her select-sheet walk covers both).

test("the single-select sheet answers on tap with radio markers and no Apply", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);

	// Open the bottom-most message's select box. (Every select box in this suite is
	// located through its own message: bare .fancySelect selectors strict-mode-violate
	// once two selects render.)
	await page.getByText("Pick exactly one:", {exact: true}).waitFor();
	const box = page
		.locator(".messagediv", {hasText: "Pick exactly one:"})
		.locator(".fancySelect input");
	await box.tap();

	const sheet = page.locator(".selectSheetBackdrop .selectSheet");
	await expect(sheet).toBeVisible();
	// Radio markers, not checkboxes; and no count/Apply footer - a single choice has
	// nothing to apply.
	await expect(sheet.locator(".selectSheetRadio")).toHaveCount(3);
	await expect(sheet.locator(".selectSheetMarker:not(.selectSheetRadio)")).toHaveCount(0);
	await expect(sheet.locator(".selectSheetFooter")).toHaveCount(0);

	// The sheet's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(page.locator(".selectSheetBackdrop")).toHaveScreenshot("single-sheet-open.png");

	// The tap is the answer: one value out, sheet gone.
	await sheet.locator(".selectSheetRow", {hasText: "Beta"}).tap();

	await expect(page.locator(".selectSheetBackdrop")).toHaveCount(0);
	const posts = await expectRequests(
		mockInstance,
		(req) => req.method === "POST" && req.pathname === "/api/v9/interactions",
		1,
	);
	const body = posts[0].body as {data: {custom_id: string; values: string[]}};
	expect(body.data.custom_id).toBe("e2e-single-select");
	expect(body.data.values).toEqual(["beta"]);

	// The choice reads back: the box's placeholder becomes the picked label, and a reopen
	// marks the picked row.
	await expect(box).toHaveAttribute("placeholder", "Beta");
	await box.tap();
	await expect(sheet).toBeVisible();
	await expect(sheet.locator(".selectSheetRow", {hasText: "Beta"})).toHaveClass(
		/selectSheetSelected/,
	);
});
