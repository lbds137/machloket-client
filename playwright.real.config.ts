import {defineConfig, devices} from "@playwright/test";
import {printTestTree} from "./e2e/testTree";

// Workers load this config too; only the run's own process prints.
if (process.env.TEST_WORKER_INDEX === undefined) printTestTree("e2e-real");

// The real-server e2e tier: the built client against a throwaway Spacebar instance, for
// behaviour the server's own rules decide. Opt-in, and never part of CI or the commit gate:
// it needs podman and a built checkout of the server; MACHLOKET_SERVER_HARNESS names that
// checkout's instance harness file.
// Each run boots one instance (e2e-real/globalSetup.ts); specs register their own accounts.
const PORT = 4175;

export default defineConfig({
	testDir: "./e2e-real",
	testMatch: /.*\.spec\.ts/,
	// A first-account request on a virgin database costs ~16 s (one-time lazy warmup).
	timeout: 90_000,
	retries: 0,
	forbidOnly: !!process.env.CI,
	reporter: "list",
	workers: 1,
	globalSetup: "./e2e-real/globalSetup.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		serviceWorkers: "block",
		locale: "en-US",
		timezoneId: "UTC",
		trace: "retain-on-failure",
	},
	projects: [{name: "chromium-phone", use: {...devices["Pixel 7"]}}],
	webServer: {
		command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
		port: PORT,
		timeout: 180_000,
		reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
	},
});
