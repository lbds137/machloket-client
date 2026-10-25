import {test as base, expect, type Page} from "@playwright/test";
import type {ModalCreateEvent} from "../src/webpage/interactions/modal";
import {type MockInstanceHandle, MOCK_CHANNEL, MOCK_INSTANCE_NAME, mountMockInstance} from "./mock";

// The shared e2e test: every spec imports this, not @playwright/test directly, so the
// off-origin abort net is inherited. A spec that
// genuinely needs a real off-origin request opts out per route with route.fulfill.
//
// The net covers http(s) only. route() cannot intercept WebSocket connections at all, so the
// app's gateway to a real instance would neither be aborted nor fail loudly — specs that
// approach gateway flows must mock the socket themselves (routeWebSocket), via mockInstance
// or mountMockInstance().

export const test = base.extend<{mockInstance: MockInstanceHandle}>({
	mockInstance: async ({page}, use) => {
		const handle = await mountMockInstance(page);
		await use(handle);
	},
});

const OFF_ORIGIN = /^https?:\/\/(?!localhost(?=:|\/|$))(?!127\.0\.0\.1(?=:|\/|$))/;

test.beforeEach(async ({context}) => {
	await context.route(OFF_ORIGIN, (route) => route.abort());
});

/** Boots the app through the mock instance into the fixture guild's #general. The tail
 * (which message or widget to wait for) stays each spec's own assert. */
export async function loginAndOpenChannel(page: Page): Promise<void> {
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
}

/** Opens a bot modal through the real entry path (button tap -> POST /api/v9/interactions
 * -> gateway INTERACTION_MODAL_CREATE carrying `modal`, keyed by the captured nonce) and
 * leaves the dialog on screen. The modal payload is pure gateway data: which form the
 * "bot" answers with is the caller's choice. The tall-form opener lives in
 * phone-layout.spec.ts; this lifted helper starts with the validation spec. */
export async function openModalViaButton(
	page: Page,
	mockInstance: MockInstanceHandle,
	modal: Omit<ModalCreateEvent, "nonce">,
): Promise<void> {
	await page.getByRole("button", {name: "Open form"}).tap();
	// The nonce is only readable once the tap's POST reaches the mock — polled so the
	// route capture and this read can't race.
	await expect
		.poll(() => {
			const post = mockInstance.capturedRequests
				.filter((req) => req.method === "POST" && req.pathname === "/api/v9/interactions")
				.at(-1);
			return (post?.body as {nonce?: string}).nonce;
		}, "the button tap must reach the mock before the modal opens")
		.toBeTruthy();
	const post = mockInstance.capturedRequests
		.filter((req) => req.method === "POST" && req.pathname === "/api/v9/interactions")
		.at(-1)!;
	const nonce = (post.body as {nonce: string}).nonce;
	mockInstance.sendGatewayEvent({op: 0, t: "INTERACTION_MODAL_CREATE", d: {...modal, nonce}});
	await expect(page.locator(".dialogModal")).toBeVisible();
}

export * from "./mock";
