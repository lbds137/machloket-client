import {expect} from "@playwright/test";
import {test} from "./fixtures";

test("the home page lists the bundled instances", async ({page}) => {
	await page.goto("/");
	await expect(page.getByRole("heading", {name: "Spacebar-compatible instances:"})).toBeVisible();
	// The bundled "Spacebar" entry must survive the docs/local overlay merge (a Deck-local
	// overlay shadows the bundled "Local server" entry by URL-dedup — instanceOverlay.ts).
	// The assertion is overlay-tolerant by design: it holds on a clean checkout (bundled
	// list only) and here (overlay entries first, bundled survivors after).
	await expect(page.getByRole("heading", {name: "Spacebar", exact: true})).toBeVisible();
});
