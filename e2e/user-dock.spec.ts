import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// The dock sits in the sidebar, which the phone profile keeps under the open main area —
// and the report is a desktop hover anyway (the Deck's pointer). Width up to desktop;
// the scale bug is width-independent. (Still the Pixel 7 profile — isMobile/hasTouch
// ride along; only the width changes.)
test.use({viewport: {width: 1280, height: 800}});

// The bottom dock (Lila 10-16, LOW/UI): hovering #userinfo scales it 1.05, and a
// transformed element paints above its untransformed siblings — with a name/status wide
// enough to fill the panel, the hover growth painted over the mic icon. The pin is
// geometry, not pixels: while hovered, the panel's transform-INCLUSIVE box (boundingBox
// includes transforms) must never reach the mic's box. The look of the hover itself stays
// a walk verdict.
test("a hovered dock panel never paints over the mic, whatever the name's width", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);

	// Positive control that the mock instance actually armed for this spec — without it the
	// app boots instance-less and the tail below would fail on setup, not on the geometry.
	expect(mockInstance.capturedRequests.length).toBeGreaterThan(0);

	// Fill the panel the way the complaint describes: the box's width is what the scale
	// multiplies, so drive the text wide. (The fixture's own name stays untouched — every
	// message-list baseline renders it.)
	await page.evaluate(() => {
		document.getElementById("username")!.textContent =
			"a-very-long-username-with-no-spaces-whatsoever";
		document.getElementById("status")!.textContent =
			"playing a status long enough to fill the panel width too";
	});

	const info = page.locator("#userinfo");

	// The expansion itself is the defect she named ("hovering expands the username/status
	// text"): hovered geometry must equal resting geometry — no scale, ever.
	const restBox = await info.boundingBox();
	await info.hover();
	const hoverBox = await info.boundingBox();
	expect(restBox).not.toBeNull();
	expect(hoverBox).not.toBeNull();
	expect(hoverBox!.x).toBe(restBox!.x);
	expect(hoverBox!.width).toBe(restBox!.width);
	expect(hoverBox!.height).toBe(restBox!.height);

	// And the structural guard underneath the original report: whatever anything later
	// does to the panel, its painted box must never reach the mic's.
	const micBox = await page.locator("#mic").boundingBox();
	expect(micBox).not.toBeNull();
	expect(micBox!.x).toBeGreaterThanOrEqual(hoverBox!.x + hoverBox!.width);
});
