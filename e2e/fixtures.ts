import {test as base} from "@playwright/test";
import {type MockInstanceHandle, mountMockInstance} from "./mock";

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

export * from "./mock";
