import {expect} from "@playwright/test";
import {test} from "./fixtures";

// The harness's own net: a request the mock doesn't answer must FAIL the test that made
// it, not just log - the app's fetch handling can swallow an aborted request and leave a
// spec green over a missing route. Each case is expected to fail; if one ever passes,
// the net has a hole and Playwright reports it. The controls run the same setup with an
// answered request and must pass, so an expected failure can't be some unrelated
// breakage in the page load or the mock.

test("control: an answered same-origin API request passes", async ({page, mockInstance}) => {
	await page.goto("/");
	const status = await page.evaluate(() =>
		fetch("/api/v9/policies/instance/config").then((r) => r.status),
	);
	expect(status).toBe(200);
	expect(mockInstance.unmocked).toEqual([]);
});

test("control: a page load with no stray request passes", async ({page}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
});

test.fail("an unmocked same-origin API request fails the test", async ({page, mockInstance}) => {
	void mockInstance; // mount the mock's routes; the handle stays unread
	await page.goto("/");
	await page.evaluate(() => fetch("/api/v9/e2e-unmocked").catch(() => undefined));
});

test.fail("a request to another localhost port fails the test", async ({page}) => {
	await page.goto("/");
	await page.evaluate(() => fetch("http://localhost:3001/api/v9/x").catch(() => undefined));
});

test.fail("an off-origin websocket fails the test", async ({page}) => {
	await page.goto("/");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const ws = new WebSocket("ws://localhost:3001/gateway");
				ws.onclose = () => resolve();
				ws.onerror = () => resolve();
				setTimeout(resolve, 3000);
			}),
	);
});
