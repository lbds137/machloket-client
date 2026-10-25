import {expect} from "@playwright/test";
import {MOCK_CHANNEL, MOCK_INSTANCE_NAME, expectRequests, test} from "./fixtures";

// T2 select-sheet pins (fancySelect.ts phone sheet). The fixture message carries a
// StringSelect with min 1 / max 2 and three described options, none pre-selected.
// The Discord-truth checks (disable-at-max and Apply-until-min FEEL like Discord) stay
// physical; these specs pin the mechanical half: open, rows, count, Apply, no-focus.

// Scoped to the multi-select's own message: the channel now also carries a
// single-select box (single-select-sheet.spec.ts), so the bare selector double-matches.
const SELECT_BOX =
	'#scrollWrap .messagediv:has-text("Choose a notification role:") .fancySelect input';
const SHEET = ".selectSheetBackdrop .selectSheet";

async function openChannelWithSelect(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/");

	const instanceHeading = page.getByRole("heading", {name: MOCK_INSTANCE_NAME, exact: true});
	await expect(instanceHeading).toBeVisible();
	await instanceHeading.click();

	await page.getByText("Already have an account?", {exact: true}).click();

	const loginForm = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});
	const loginSubmit = loginForm.getByRole("button", {name: "Login", exact: true});
	await expect(loginSubmit).toBeEnabled();

	await loginForm
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill("testuser@example.test");
	await loginForm
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill("e2e-mock-password");
	await loginSubmit.click();

	await expect(page).toHaveURL(/\/channels\/@me$/);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/);

	const guildIcon = page.locator("#servers img.servericon").filter({visible: true}).first();
	await expect(guildIcon).toBeVisible();
	await guildIcon.click();

	const channelButton = page.locator("#channels button.channelbutton", {
		hasText: MOCK_CHANNEL.name,
	});
	await expect(channelButton).toBeVisible();
	await channelButton.click();
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);

	await expect(page.locator(SELECT_BOX)).toBeVisible();
}

async function openSheet(page: import("@playwright/test").Page): Promise<void> {
	// A synthetic tap: pointerdown opens the sheet and preventDefault keeps the
	// on-screen keyboard shut (fancySelect.ts input.onpointerdown).
	await page.locator(SELECT_BOX).tap();
	await expect(page.locator(SHEET)).toBeVisible();
}

test("tapping the select box opens the sheet without focusing it", async ({
	page,
	mockInstance,
}) => {
	await openChannelWithSelect(page);
	await openSheet(page);

	// The box never took focus (a real keyboard would be up); onfocus's own
	// openSheet-then-blur fallback would also land here, so this holds either way.
	await expect(page.locator(SELECT_BOX)).not.toBeFocused();

	// The first Deck-local pixel baseline: open sheet over the dim backdrop, with
	// real CSS at the phone viewport (baselines are Deck-local by decision; DOM
	// asserts lead, this pins the chrome/look). Determinism comes from the config's
	// toHaveScreenshot defaults (animations fast-forwarded, caret hidden).
	await expect(page.locator(".selectSheetBackdrop")).toHaveScreenshot("sheet-open.png");

	// The mock saw no interaction before any sheet action.
	expect(
		mockInstance.capturedRequests.filter((req) => req.pathname === "/api/v9/interactions"),
	).toHaveLength(0);
});

test("sheet chrome: rows, count, header join, disable-at-max, Apply sends", async ({
	page,
	mockInstance,
}) => {
	await openChannelWithSelect(page);
	await openSheet(page);

	const sheet = page.locator(SHEET);

	// One row per option, each with its label and description, and a checkbox
	// (multi-select markers, not radios).
	const rows = sheet.locator(".selectSheetRow");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText("Announcements");
	await expect(rows.nth(0)).toContainText("Release and outage notices");
	await expect(rows.nth(1)).toContainText("Builds");
	await expect(rows.nth(1)).toContainText("CI and nightly build alerts");
	await expect(rows.nth(2)).toContainText("Releases");
	await expect(rows.nth(2)).toContainText("Tagged version announcements");
	await expect(sheet.locator("input.selectSheetMarker")).toHaveCount(3);

	// Nothing pre-selected: empty header, zero count, Apply gated by min_values 1.
	await expect(sheet.locator(".selectSheetTitle")).toHaveText("");
	await expect(sheet.locator(".selectSheetCount")).toHaveText("0 selected");
	const apply = sheet.locator(".selectSheetApply");
	await expect(apply).toBeDisabled();

	// Choose in reverse order: the count and Apply follow every tap. Rows are
	// addressed by index — the order the asserts above just pinned — because
	// hasText would reach the descriptions too ("Tagged version announcements"
	// contains "Announcements"). The header join is rendered once at open (current
	// behavior — pinned; whether it should live-update with the chosen labels is
	// filed for the phone walk).
	await rows.nth(1).tap();
	await expect(sheet.locator(".selectSheetCount")).toHaveText("1 selected");
	await rows.nth(0).tap();
	await expect(sheet.locator(".selectSheetCount")).toHaveText("2 selected");
	await expect(sheet.locator(".selectSheetTitle")).toHaveText("");

	// At max_values 2 the unchosen row is disabled and its tap is ignored — no
	// error, no selection, count unchanged.
	const releasesRow = rows.nth(2);
	await expect(releasesRow).toHaveClass(/selectSheetDisabled/);
	await releasesRow.tap();
	await expect(sheet.locator(".selectSheetCount")).toHaveText("2 selected");
	await expect(releasesRow).not.toHaveClass(/selectSheetSelected/);
	await expect(sheet.locator(".fancySelectError")).toHaveText("");

	await apply.tap();

	// Apply is the only send: the sheet closes and exactly one interaction carries
	// the applied values in option order.
	await expect(page.locator(".selectSheetBackdrop")).toHaveCount(0);
	const interactions = await expectRequests(
		mockInstance,
		(req) => req.method === "POST" && req.pathname === "/api/v9/interactions",
		1,
	);
	expect(interactions[0].body).toMatchObject({
		data: {component_type: 3, custom_id: "e2e-role-select", values: ["announcements", "builds"]},
	});
});

test("closing the sheet discards: the choice reverts and nothing is sent", async ({
	page,
	mockInstance,
}) => {
	await openChannelWithSelect(page);
	await openSheet(page);

	const sheet = page.locator(SHEET);
	const rows = sheet.locator(".selectSheetRow");

	await rows.nth(1).tap();
	await expect(sheet.locator(".selectSheetCount")).toHaveText("1 selected");

	await sheet.locator(".selectSheetClose").tap();
	await expect(page.locator(".selectSheetBackdrop")).toHaveCount(0);

	// Reopen: the tapped row is back to unselected and the count is reset.
	await openSheet(page);
	await expect(sheet.locator(".selectSheetCount")).toHaveText("0 selected");
	await expect(rows.nth(1)).not.toHaveClass(/selectSheetSelected/);

	expect(
		mockInstance.capturedRequests.filter((req) => req.pathname === "/api/v9/interactions"),
	).toHaveLength(0);
});
