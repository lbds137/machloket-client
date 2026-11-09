import {expect} from "@playwright/test";
import {DESKTOP, loginAndOpenChannel, test} from "./fixtures";

// fill() changes a field the way a paste, dictation or a keyboard suggestion does: input events
// and no key press.
test.use(DESKTOP);

test("the header search box reads as searching for text that arrives without a key", async ({
	page,
	mockInstance,
}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await loginAndOpenChannel(page);

	await page.locator("#searchBox").fill("zebra");

	await expect(page.locator("#searchX")).toHaveClass(/svg-plainx/);
});

test("the GIF search runs on text that arrives without a key", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	const searches: string[] = [];
	await page.route("**/gifs/**", (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/gifs/search")) searches.push(url.searchParams.get("q") ?? "");
		return route.fulfill({
			json: url.pathname.endsWith("/gifs/search") ? [] : {categories: [], gifs: []},
		});
	});
	await loginAndOpenChannel(page);
	await page.locator("#gifTB").click();

	await page.locator(".searchGifBar").fill("zebra");

	await expect.poll(() => searches).toContain("zebra");
});
