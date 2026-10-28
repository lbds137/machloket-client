import {test as base, expect, type Locator, type Page} from "@playwright/test";
import type {ModalCreateEvent} from "../src/webpage/interactions/modal";
import {
	type CapturedRequest,
	type MockInstanceHandle,
	type MockInstanceOptions,
	MOCK_CHANNEL,
	MOCK_INSTANCE_NAME,
	mountMockInstance,
} from "./mock";

// The shared e2e test: every spec imports this, not @playwright/test directly, so the
// network net is inherited. Anything that leaves the preview server (http(s) to any other
// host or port, any WebSocket) is aborted AND fails the test at teardown, as does a
// same-origin API request the mock doesn't answer - the app's fetch handling can swallow
// an aborted request, so a log line alone would leave a spec green over a missing route.
// A spec that genuinely needs one of these answers it with its own page-level route,
// which takes precedence over the context-level net. e2e/harness.spec.ts pins the net.

const PREVIEW = "localhost:4173";
const OFF_PREVIEW = /^https?:\/\/(?!localhost:4173(?=\/|$))/;

export const test = base.extend<{mockInstance: MockInstanceHandle; mockInstanceOptions: MockInstanceOptions; network: void}>({
	mockInstanceOptions: [{}, {option: true}],
	network: [
		async ({context}, use) => {
			const escaped: string[] = [];
			await context.route(OFF_PREVIEW, (route) => {
				escaped.push(route.request().url());
				return route.abort();
			});
			// Registered at context level, so the mock's page-level gateway route wins for its
			// own socket; every other socket lands here.
			await context.routeWebSocket(/.*/, (ws) => {
				escaped.push(ws.url());
				ws.close().catch(() => {});
			});
			await use();
			expect(escaped, `requests that left ${PREVIEW}`).toEqual([]);
		},
		{auto: true},
	],
	mockInstance: async ({page, mockInstanceOptions}, use) => {
		const handle = await mountMockInstance(page, mockInstanceOptions);
		await use(handle);
		expect(handle.unmocked, "same-origin requests the mock doesn't answer").toEqual([]);
	},
});

/** The captured requests matching `match`, once exactly `count` of them have arrived. An
 * action's request reaches the mock asynchronously, so a read right after the tap can
 * race it: this polls, then re-reads after a short settle so a late duplicate can't hide
 * behind the first match ("exactly one send" claims). */
export async function expectRequests(
	mockInstance: MockInstanceHandle,
	match: (req: CapturedRequest) => boolean,
	count: number,
	message = `exactly ${count} matching request(s) reach the mock`,
): Promise<CapturedRequest[]> {
	const matching = () => mockInstance.capturedRequests.filter(match);
	await expect.poll(() => matching().length, message).toBe(count);
	await new Promise((resolve) => setTimeout(resolve, 300));
	expect(matching(), message).toHaveLength(count);
	return matching();
}

/** Deck-local pixel pin. The baselines encode the Deck's font rendering; a CI runner's
 * fonts can never match them, so under CI this is a no-op and the spec's DOM asserts lead
 * (the pins only ever guarded local rendering — the tooling scope doc keeps pixels local). */
export async function pinShot(locator: Locator, name: string): Promise<void> {
	if (process.env.CI) {
		base.info().annotations.push({type: "pinShot", description: `skipped under CI: ${name}`});
		return;
	}
	await expect(locator).toHaveScreenshot(name);
}

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
	// A run's first test boots against a cold preview server and browser cache: the default
	// 5s budget has run out there (two sightings, each the run's first test, green on
	// repeat). The boot itself isn't under test here.
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});

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
 * "bot" answers with is the caller's choice. */
export async function openModalViaButton(
	page: Page,
	mockInstance: MockInstanceHandle,
	modal: Omit<ModalCreateEvent, "nonce">,
): Promise<void> {
	await page.getByRole("button", {name: "Open form"}).tap();
	// The nonce is only readable once the tap's POST reaches the mock — polled so the
	// route capture and this read can't race. The callback must not throw on an empty
	// tick: Playwright's poll retries a value, not an exception.
	await expect
		.poll(() => {
			const post = mockInstance.capturedRequests
				.filter((req) => req.method === "POST" && req.pathname === "/api/v9/interactions")
				.at(-1);
			return (post?.body as {nonce?: string} | undefined)?.nonce;
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
