import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// The blocked-message run (walk item: expand a "N blocked messages" bar — does the view
// hold?). READY carries a type-2 relationship for the fixture peer; their two consecutive
// messages collapse behind one bar on the run's first message. The tap pins BEHAVIOR:
// expand shows both messages plus a hide-bar, and the view stays anchored at the tap
// point (snapBottom only snaps when the channel is already at the bottom); whether that
// feel is Discord-truth stays a walk verdict. The 420px
// viewport makes the channel actually scroll, so "stays anchored" is a real
// assertion rather than a vacuous one.

test.use({viewport: {width: 412, height: 420}});

test("the blocked run collapses behind one bar with the right count", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const bar = page.locator(".topMessage.blocked");
	await expect(bar).toHaveCount(1);
	await expect(bar).toContainText("You have this user blocked, click to see the 2 blocked");
	await expect(page.getByText("blocked message one", {exact: true})).toBeHidden();
	await expect(page.getByText("blocked message two", {exact: true})).toBeHidden();

	// The collapsed run's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(bar).toHaveScreenshot("blocked-bar.png");
});

test("expanding the bar shows the run and holds the view at the tap point, then re-collapses", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const bar = page.locator(".topMessage.blocked");
	await expect(bar).toHaveCount(1);
	// Bring the bar on screen the way a person would (it starts scrolled off above the
	// fold at this viewport) - the tap itself must not scroll.
	await bar.scrollIntoViewIfNeeded();

	await bar.tap();

	// Both run messages are readable, and the run's first message carries the hide-bar.
	await expect(page.getByText("blocked message one", {exact: true})).toBeVisible();
	await expect(page.getByText("blocked message two", {exact: true})).toBeVisible();
	const hideBar = page.locator("span.blocked");
	await expect(hideBar).toHaveCount(1);
	await expect(hideBar).toContainText("click to hide these messages");

	// The expansion holds the view at the tap point: infiniteScroller.snapBottom only
	// snaps when the channel was already at the bottom (otherwise it returns a no-op),
	// so from mid-channel nothing re-anchors - the bar and the run stay in view, and the
	// messages below the run may slide out of the viewport. That hold is the walk item's
	// mechanized answer; whether it FEELS right stays hers.
	await expect(hideBar, "the tap point stays in view through the expansion").toBeInViewport();
	await expect(
		page.getByText("blocked message two", {exact: true}),
		"the run expands on screen",
	).toBeInViewport();

	// And the reverse tap folds the run back behind the single bar.
	await hideBar.tap();
	await expect(bar).toHaveCount(1);
	await expect(bar).toContainText("click to see the 2 blocked");
	await expect(page.getByText("blocked message one", {exact: true})).toBeHidden();
});
