import {expect} from "@playwright/test";
import {loginAndOpenChannel, test} from "./fixtures";
import {DEFAULT_SOURCE_REPO} from "../src/webpage/utils/sourceOffer";

test.use({viewport: {width: 1280, height: 800}});

// AGPL-3.0 section 13: the running app offers its users the source of the version they use.
test("Client information credits Fermo and links the source of this build", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	await page.locator("#settings").click();
	await page
		.locator('.settingbuttons .cardLink[data-section="Instance Info"]', {
			hasText: "Client information",
		})
		.click();

	const credit = page.getByText("Machloket is free software (AGPL-3.0).");
	await expect(credit).toBeVisible();
	await expect(credit).toContainText("Based on Fermo (AGPL-3.0) by its authors.");
	// The e2e build runs in a git checkout, so the revision is the commit it was built from.
	const link = credit.getByRole("link");
	await expect(link).toHaveAttribute(
		"href",
		new RegExp(`^${DEFAULT_SOURCE_REPO.replaceAll(".", "\\.")}/tree/[0-9a-f]{40}$`),
	);
	// Underlined, so it reads as a link without its colour (the app's links are colour-only).
	await expect(link).toHaveCSS("text-decoration-line", "underline");
});
