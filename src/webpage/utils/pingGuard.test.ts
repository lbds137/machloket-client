import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const utils = await import("./utils");
const {I18n} = await import("../i18n");

// Button labels hydrate asynchronously; drive the dialog only once they have landed.
await I18n.done;

const {checkURLs, pingOK, pingTimeoutMs} = utils;

afterEach(() => {
	// unstub — not restoreAllMocks: the latter would also tear down the harness setup's
	// own fetch answering for every test after the first.
	vi.unstubAllGlobals();
	// A dialog left open poisons the next test's button lookup — take every one down.
	document.querySelectorAll(".background").forEach((b) => b.remove());
});

/** The viewer's well-known sits on loopback while the API it announces does not — that
 * mismatch is what opens checkURLs' confirm dialog. */
const WELLKNOWN = "http://127.0.0.1:3001";
const URLS = {
	wellknown: WELLKNOWN,
	api: "https://api.test/api",
	cdn: "https://cdn.test",
	gateway: "wss://api.test",
};

/** Stub fetch where every /ping behaves per `ping` (the only requests these flows make). A
 * hung ping rejects only when its caller's signal aborts, so the timeout path is observable
 * while a pre-fix call simply never settles. stubGlobal, not spyOn: unstubAllGlobals is the
 * exact inverse of this stub and leaves the harness setup's own fetch answering
 * (stubGlobal'd in src/webpage/test/setup.ts) untouched — one mechanism, no ordering. */
function stubPings(ping: () => Response | "hang") {
	vi.stubGlobal(
		"fetch",
		(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const asked = ping();
			if (asked !== "hang") return Promise.resolve(asked);
			return new Promise<Response>((_, rej) => {
				init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
			});
		},
	);
}

async function clickDialogButton(label: string) {
	const dialog = document.querySelector(".dialogModal");
	const button = [...(dialog?.querySelectorAll("button") ?? [])].find(
		(b) => b.textContent?.trim() === label,
	);
	expect(button, `dialog button "${label}"`).toBeDefined();
	button!.click();
}

/**
 * REAL timers throughout: faking them starves the dialog's render path and the abort
 * budget never lands (a full afternoon of fake-timer variants, 10-29), so the hang pins
 * wait out the real 10 s budget instead. Slow by design; each is bounded well under its
 * own timeout.
 */
const HANG_IT = {timeout: 30_000} as const;

/** Resolves how the wait ended: the promise settled, or the budget-plus-slack ran out. */
function withinBudget(p: Promise<unknown>): Promise<string> {
	return Promise.race([
		p.then(
			() => "settled",
			() => "error",
		),
		new Promise<string>((r) => setTimeout(() => r("unsettled"), pingTimeoutMs + 5_000)),
	]);
}

it("pingOK: a ping that never answers reads as a miss inside the budget", HANG_IT, async () => {
	stubPings(() => "hang");
	const verdict = await Promise.race([
		pingOK(URLS.api).then(
			(ok) => (ok ? "answered-true" : "miss"),
			(e) => `threw:${(e as Error).name}`,
		),
		new Promise<string>((r) => setTimeout(() => r("pending"), pingTimeoutMs + 2_000)),
	]);
	expect(verdict).toBe("miss");
});

it("pingOK: an ok ping is true and a non-ok ping is false", async () => {
	stubPings(() => Response.json({}));
	expect(await pingOK(URLS.api)).toBe(true);
	vi.unstubAllGlobals();
	stubPings(() => Response.json({}, {status: 503}));
	expect(await pingOK(URLS.api)).toBe(false);
});

it("checkURLs: a hung ping still resolves null after the No button", HANG_IT, async () => {
	stubPings(() => "hang");
	const p = checkURLs(WELLKNOWN, URLS);
	await new Promise((r) => setTimeout(r, 50));
	await clickDialogButton(I18n.no());
	expect(await withinBudget(p)).toBe("settled");
	expect(await p).toBeNull();
});

it("checkURLs: a hung ping still resolves null after the Yes button", HANG_IT, async () => {
	stubPings(() => "hang");
	const p = checkURLs(WELLKNOWN, URLS);
	await new Promise((r) => setTimeout(r, 50));
	await clickDialogButton(I18n.yes());
	expect(await withinBudget(p)).toBe("settled");
	expect(await p).toBeNull();
});

it("checkURLs: answered pings resolve the urls (the control)", async () => {
	stubPings(() => Response.json({}));
	const p = checkURLs(WELLKNOWN, URLS);
	await new Promise((r) => setTimeout(r, 50));
	await clickDialogButton(I18n.yes());
	// The Yes button's contract: the announced api is rewritten to the well-known origin.
	expect(await p).toMatchObject({api: "http://127.0.0.1:3001/api"});
});
