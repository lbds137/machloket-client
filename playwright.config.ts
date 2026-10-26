import {defineConfig, devices} from "@playwright/test";

// e2e tier: drives the BUILT app with real CSS at a phone viewport.
// The webServer command builds first, so
// `npm run test:e2e` can never green-light code the tests did not see. Files are
// *.spec.ts so the unit gate (vitest, **/*.test.ts) never picks them up; tsc's project
// include is src/** only — the e2e tier is typechecked by `npm run check:e2e` instead.
export default defineConfig({
	testDir: "./e2e",
	testMatch: /.*\.spec\.ts/,
	timeout: 30_000,
	retries: 0,
	// 14 GB Deck: one Chromium at a time. Two workers ran the phone suite ~2× faster but
	// reproduced a 30 s menu-open stall under swap pressure (icons:101, three 10-26
	// sightings, always concurrent, never solo); solo is the supported mode.
	workers: 1,
	use: {
		baseURL: "http://localhost:4173",
		// The app registers a precaching service worker, and route() cannot intercept
		// service-worker requests — block it so every test sees the network directly.
		serviceWorkers: "block",
		// Rendered dates (embed footers, message stamps) follow the browser's locale and
		// zone: pinned so a baseline doesn't depend on the machine's.
		locale: "en-US",
		timezoneId: "UTC",
	},
	projects: [{name: "chromium-phone", use: {...devices["Pixel 7"]}}],
	// Baselines must be deterministic: entry animations fast-forwarded, caret hidden.
	expect: {
		toHaveScreenshot: {animations: "disabled", caret: "hide"},
	},
	webServer: {
		command: "npm run build && npx vite preview --port 4173 --strictPort",
		port: 4173,
		// A cold build on the 14 GB Deck can outwait Playwright's 60 s default.
		timeout: 180_000,
		// Reuse only on explicit request: with strictPort, silent reuse would adopt
		// whatever already answers on 4173, whatever it is serving.
		reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
	},
});
