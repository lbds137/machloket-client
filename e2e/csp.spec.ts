import {readFileSync, readdirSync} from "node:fs";
import {expect} from "@playwright/test";
import {test, drain} from "./fixtures";

// The Content-Security-Policy the client ships (src/webpage/utils/contentSecurityPolicy.ts).
// The preview server sends it on every response (vite.config.js, preview.headers), and the
// cspViolations fixture fails any spec whose page breaks it. These pin the net itself: the
// header is the built one, and each kind of refusal is both enforced and reported. A control
// that provokes a violation on purpose empties the list once it has checked it.

const builtPolicy = () => {
	const headers = readFileSync(new URL("../dist/webpage/_headers", import.meta.url), "utf8");
	const line = headers.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
	return line?.trim().slice("Content-Security-Policy:".length).trim();
};

test("the preview serves the policy the build ships in _headers", async ({page}) => {
	const response = await page.goto("/");
	const policy = builtPolicy();
	expect(policy).toContain("script-src 'self' https://js.hcaptcha.com;");
	expect(response?.headers()["content-security-policy"]).toBe(policy);
});

test("control: an element can still be cleared through innerHTML", async ({page}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const cleared = await page.evaluate(() => {
		const div = document.createElement("div");
		div.append("text");
		div.innerHTML = "";
		return div.childNodes.length;
	});
	expect(cleared).toBe(0);
});

test("markup assigned to innerHTML is refused and reported", async ({page, cspViolations}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const outcome = await page.evaluate(() => {
		const div = document.createElement("div");
		try {
			div.innerHTML = "<b>injected</b>";
			return `assigned: ${div.childNodes.length} node(s)`;
		} catch (e) {
			return `refused: ${(e as Error).name}`;
		}
	});
	expect(outcome).toBe("refused: TypeError");
	await expect
		.poll(() => cspViolations.map((v) => v.directive))
		.toContain("require-trusted-types-for");
	cspViolations.length = 0;
});

test("a cross-origin worker URL is refused", async ({page, cspViolations}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const outcome = await page.evaluate(() => {
		try {
			new Worker("https://worker.example.test/w.js");
			return "constructed";
		} catch (e) {
			return `refused: ${(e as Error).name}`;
		}
	});
	expect(outcome).toBe("refused: TypeError");
	await expect
		.poll(() => cspViolations.map((v) => v.directive))
		.toContain("require-trusted-types-for");
	cspViolations.length = 0;
});

// No eval control here: code run through page.evaluate is exempt from the page's policy (an eval
// in it runs). The client's own eval refusal is covered by the build, which fails on an eval or
// Function() call in the emitted code, and by the sound editor spec below, whose formulas were
// the one place that compiled code.

test("an injected inline event handler is refused and reported", async ({page, cspViolations}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const outcome = await page.evaluate(() => {
		const button = document.createElement("button");
		try {
			button.setAttribute("onclick", "document.body.dataset.injected = 'ran'");
		} catch (e) {
			return `refused: ${(e as Error).name}`;
		}
		document.body.append(button);
		button.click();
		button.remove();
		return `set; handler ${document.body.dataset.injected ?? "did not run"}`;
	});
	expect(outcome).toBe("refused: TypeError");
	await expect
		.poll(() => cspViolations.map((v) => v.directive))
		.toContain("require-trusted-types-for");
	cspViolations.length = 0;
});

// The net's own control: a violation left in the list fails the spec at teardown.
test.fail("a violation nobody expected fails the test", async ({page, cspViolations}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	await page.evaluate(() => {
		try {
			document.createElement("div").innerHTML = "<b>injected</b>";
		} catch {
			// refused, and reported: the fixture's teardown is what must fail
		}
	});
	await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
});

// The client fetches its own blob: and data: URLs: an audio file's preview reads its tags from
// the blob: URL of the user's file (media.ts, IdentifyFile), and saved notification sounds are
// data: URLs (utils/storage/notificationSoundStorage.ts).
test("the page can fetch a blob: and a data: URL it made", async ({page}) => {
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const bodies = await page.evaluate(async () => {
		const blobUrl = URL.createObjectURL(new Blob(["from a blob"]));
		const read = (url: string) =>
			fetch(url).then(
				(r) => r.text(),
				(e: unknown) => `failed: ${String(e)}`,
			);
		return [await read(blobUrl), await read("data:text/plain,from%20data")];
	});
	expect(bodies).toEqual(["from a blob", "from data"]);
});

// An instance can ask for an hCaptcha (settings.ts, Captcha), whose script and challenge frame
// come from hCaptcha's hosts. Answered here by a route: the real script ran with no violation
// under this policy in a one-off probe (TASK-135, hCaptcha's public test sitekey).
test("the hCaptcha script may load", async ({page}) => {
	await page.route("https://js.hcaptcha.com/1/api.js", (route) =>
		route.fulfill({contentType: "text/javascript", body: "window.__hcaptchaRan = true;"}),
	);
	await page.goto("/");
	await expect(page.locator("body")).toBeAttached();
	const outcome = await page.evaluate(
		() =>
			new Promise<string>((done) => {
				const script = document.createElement("script");
				try {
					script.src = "https://js.hcaptcha.com/1/api.js";
				} catch (e) {
					done(`refused: ${(e as Error).name}`);
					return;
				}
				script.onload = () =>
					done((window as {__hcaptchaRan?: boolean}).__hcaptchaRan ? "ran" : "loaded only");
				script.onerror = () => done("blocked");
				document.body.append(script);
			}),
	);
	expect(outcome).toBe("ran");
});

// The service worker registers while the first shared chunk evaluates (utils/utils.ts, SW.start
// at module level), so the default policy must exist before any chunk's top-level code runs,
// not just before the entry's. The tier blocks service workers; this spec allows them.
test.describe("with the service worker on", () => {
	test.use({serviceWorkers: "allow"});
	test("it registers at boot under the policy", async ({page}) => {
		await page.addInitScript(() => {
			localStorage.setItem("localSettings", JSON.stringify({serviceWorkerMode: "offlineOnly"}));
		});
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/");
		await expect
			.poll(() =>
				page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope),
			)
			.toMatch(/^http:\/\/localhost:4173\/$/);
		expect(errors).toEqual([]);
	});
});

// The sound editor parses its formulas on the page (they once compiled to code) and loads its
// audio worklet at boot (once shipped as a data: URL holding the raw TypeScript, which failed
// to load with or without a policy). Playwright sees no request for a worklet module, so the
// shipped file is loaded once more here, by name, and handed the editor's sounds to parse.
test("the sound editor parses its formulas and loads its worklet under the policy", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/audio/");
	// Set right after the formulas are parsed and the worklet's load is started (audio/page.ts).
	await expect.poll(() => page.evaluate(() => document.onclick !== null)).toBe(true);
	const workletFile = readdirSync(new URL("../dist/webpage/assets/", import.meta.url)).filter(
		(name) => /^worklet-[\w-]+\.js$/.test(name),
	);
	expect(workletFile).toHaveLength(1);
	// The editor's own sounds, as its Download button saves them: parsing them in the worklet
	// parses every formula, the custom one included (audio/page.ts), in the worklet's scope.
	const download = page.waitForEvent("download");
	await page.locator("#download").click();
	const bytes = [...readFileSync((await (await download).path())!)];
	const tracks = await page.evaluate(
		async ({url, bytes}) => {
			const context = new AudioContext();
			try {
				await context.audioWorklet.addModule(url);
				const node = new AudioWorkletNode(context, "audio");
				const reply = new Promise<unknown>((done) => {
					node.port.onmessage = (message) => done(message.data);
					setTimeout(() => done("no reply in 5 s"), 5000);
				});
				node.port.postMessage({name: "bin", bin: new Uint8Array(bytes).buffer});
				node.port.postMessage({name: "getTracks"});
				return await reply;
			} catch (e) {
				return `failed: ${String(e)}`;
			} finally {
				await context.close();
			}
		},
		{url: `/assets/${workletFile[0]}`, bytes},
	);
	expect(tracks).toEqual({name: "tracks", tracks: ["zip", "beep", "three", "square", "join"]});
	// A click plays a sound, which waits on the page's own worklet load: a refused or broken
	// module rejects there, as a page error.
	await page.locator("body").click();
	await drain(page);
	expect(errors).toEqual([]);
});
