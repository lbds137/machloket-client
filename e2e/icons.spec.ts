import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";

// Walk item 1j mechanized: the icon set renders through CSS masks (style.css
// `mask: url(./icons/*.svg)` on .svgicon elements) — a broken or missing icon file
// renders an invisible element, which text/DOM asserts can't see at all. The pins:
// id-carrying chrome icons resolve a real mask URL, the header's look has a Deck-local
// baseline, and the context menu (its own icon surface) does too.

test("the app chrome's icons resolve real mask files", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const report = await page.evaluate(() => {
	 const broken: string[] = [];
	 let masked = 0;
	 document.querySelectorAll(".svgicon").forEach((el) => {
		 const mask = getComputedStyle(el).maskImage;
		 if (mask && mask !== "none") {
			 masked++;
		 } else if (el.id) {
			 broken.push("#" + el.id);
		 }
	 });
	 return {broken, masked};
	});
	expect(
		report.broken,
		"id-carrying chrome icons must resolve a mask (an unmasked icon renders invisible)",
	).toEqual([]);
	expect(report.masked).toBeGreaterThan(5);

	// Spot-check the specific file: the settings gear is the settings icon - and the
	// icon FILE actually serves (the mask rule alone would hide a 404'd svg silently).
	const settingsMask = await page
		.locator("#settings")
		.evaluate((el) => getComputedStyle(el).maskImage);
	expect(settingsMask).toContain("settings.svg");
	const iconUrl = settingsMask.slice(4, -1).replace(/"/g, "");
	const iconResponse = await page.request.get(iconUrl);
	expect(iconResponse.ok(), "the masked icon file must serve").toBe(true);
});

test("the header's icons render and look right", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	const header = page.locator(".channelnamediv");
	await expect(header).toBeVisible();
	// The five header icons: category toggle, pins, search, inbox, members.
	for (const id of ["pinnedM", "searchX", "inboxM"]) {
		const mask = await page
			.locator("#" + id)
			.evaluate((el) => getComputedStyle(el).maskImage);
		expect(mask, "#" + id + " must resolve a mask").not.toBe("none");
	}

	// The header's look, Deck-local baseline (DOM asserts lead; this pins the chrome).
	await expect(header).toHaveScreenshot("header-icons.png");
});

test("the context menu's icons render and the menu looks right", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	await page
		.locator(".messagediv", {hasText: "Welcome to the mock guild!"})
		.click({button: "right"});
	const menu = page.locator(".contextmenu");
	await expect(menu).toBeVisible();

	// The Forward item's icon reuses the reply arrow mirrored (style.css .svg-forward:
	// mask reply.svg + scaleX(-1)) - Discord's own forward glyph.
	const forward = menu.locator(".svgicon.svg-forward");
	const forwardStyle = await forward.evaluate((el) => {
		const s = getComputedStyle(el);
		return {mask: s.maskImage, transform: s.transform};
	});
	expect(forwardStyle.mask).toContain("reply.svg");
	expect(forwardStyle.transform).toBe("matrix(-1, 0, 0, 1, 0, 0)");

	// The menu's look, Deck-local baseline.
	await expect(menu).toHaveScreenshot("context-menu.png");
});
