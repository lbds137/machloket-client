import {expect} from "@playwright/test";
import {loginAndOpenChannel, test, pinShot} from "./fixtures";

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
		const urls = new Set<string>();
		document.querySelectorAll(".svgicon").forEach((el) => {
			const mask = getComputedStyle(el).maskImage;
			const url = mask?.match(/url\("?([^")]+)"?\)/)?.[1];
			if (url) {
				urls.add(url);
			} else if (el.id) {
				broken.push("#" + el.id);
			}
		});
		return {broken, urls: [...urls]};
	});
	expect(
		report.broken,
		"id-carrying chrome icons must resolve a mask (an unmasked icon renders invisible)",
	).toEqual([]);
	expect(report.urls.length).toBeGreaterThan(5);

	// Every mask FILE must actually be an SVG: the mask rule alone hides a missing file,
	// and the preview server answers a missing path 200 with its HTML fallback page - a
	// status check can't tell. The settings gear is spot-checked by name.
	const settingsMask = await page
		.locator("#settings")
		.evaluate((el) => getComputedStyle(el).maskImage);
	expect(settingsMask, "the settings gear is the settings icon").toContain("settings.svg");
	const notSvg: string[] = [];
	for (const url of report.urls) {
		const response = await page.request.get(url);
		const type = response.headers()["content-type"] ?? "";
		if (!response.ok() || !type.startsWith("image/svg+xml")) notSvg.push(`${url} (${type})`);
	}
	expect(notSvg, "every masked icon file must serve an SVG").toEqual([]);
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
	await pinShot(header, "header-icons.png");
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

	// The Copy-message-link row carries its own glyph (svg-link): the icon must render
	// a real mask, not an invisible span.
	const linkIcon = menu
		.locator(".contextbutton", {hasText: "Copy message link"})
		.locator(".svgicon.svg-link");
	await expect(linkIcon).toHaveCount(1);
	const linkMask = await linkIcon.evaluate((el) => getComputedStyle(el).maskImage);
	expect(linkMask, "the copy-link icon must resolve a mask").not.toBe("none");

	// The menu's look, Deck-local baseline.
	await pinShot(menu, "context-menu.png");
});

test("the queued menu rows carry icons and every new mask serves", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	// Opening the channel slid the chat over the drawer (index.ts setMainOpen(true) on
	// the channel-list click); the menu under test lives in the drawer, so restore the
	// drawer the way the swipe's closeChat does before right-clicking into it. Without
	// this the right-click races the 0.3s slide and loses whenever the machine is slow.
	await page.evaluate(() => {
		const toggle = document.getElementById("maintoggle") as HTMLInputElement | null;
		if (toggle) {
			toggle.checked = false;
			toggle.dispatchEvent(new Event("change"));
		}
	});
	await expect(page.locator("#page")).not.toHaveClass(/mobileMainOpen/);

	// Channel menu: the notifications and copy-ID rows.
	await page
		.locator("#channels button.channelbutton", {hasText: "general"})
		.click({button: "right"});
	// Channel menu: the notifications and copy-ID rows. The invite row is hidden here
	// (@everyone lacks CREATE_INSTANT_INVITE in the mock - the T4g demotion), so its
	// class rides the mask-declaration probe below instead.
	const chanMenu = page.locator(".contextmenu");
	await expect(chanMenu).toBeVisible();
	for (const css of ["svg-bell", "svg-hash"]) {
		await expect(chanMenu.locator(".svgicon." + css), css + " must render").toHaveCount(1);
	}

	// Guild menu: the admins row.
	await page
		.locator("#servers img.servericon")
		.filter({visible: true})
		.first()
		.click({button: "right"});
	const guildMenu = page.locator(".contextmenu:not(.removeElm)");
	await expect(guildMenu).toBeVisible();
	await expect(guildMenu.locator(".svgicon.svg-shield"), "svg-shield must render").toHaveCount(1);

	// The kick/ban rows (user menu) have no cheap fixture surface; their classes are
	// pinned here instead: all seven queued classes must declare a mask whose FILE is
	// an SVG (a missing file still answers 200 with the HTML fallback - a status check
	// can't tell).
	const classes = [
		"svg-link",
		"svg-userplus",
		"svg-bell",
		"svg-hash",
		"svg-shield",
		"svg-userx",
		"svg-gavel",
	];
	const urls = await page.evaluate((classNames) => {
		const found: string[] = [];
		for (const css of classNames) {
			const probe = document.createElement("span");
			probe.className = "svgicon " + css;
			document.body.appendChild(probe);
			const url = getComputedStyle(probe).maskImage.match(/url\("?([^")]+)"?\)/)?.[1];
			probe.remove();
			if (url) found.push(url);
		}
		return found;
	}, classes);
	expect(
		urls,
		"all seven queued icon classes must declare a mask (found " + urls.length + ")",
	).toHaveLength(classes.length);
	const notSvg: string[] = [];
	for (const url of urls) {
		const response = await page.request.get(url);
		const type = response.headers()["content-type"] ?? "";
		if (!response.ok() || !type.startsWith("image/svg+xml")) notSvg.push(`${url} (${type})`);
	}
	expect(notSvg, "every queued icon file must serve an SVG").toEqual([]);
});
