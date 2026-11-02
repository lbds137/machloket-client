import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
const {RecoveryBanner} = await import("./recoveryBanner");
await I18n.done;

const API = "https://recovery.test/api/v9";
const URL_RECOVERY = API + "/users/@me/mfa/recovery";

let banner: HTMLDivElement;
let text: HTMLSpanElement;
let when: HTMLSpanElement;
let error: HTMLSpanElement;
let cancel: HTMLButtonElement;
const created: InstanceType<typeof RecoveryBanner>[] = [];

function makeBanner(
	api = API,
	headers: () => HeadersInit = () => ({Authorization: "tok-default"}),
) {
	const instance = new RecoveryBanner(() => api, headers);
	created.push(instance);
	return instance;
}

beforeEach(() => {
	document.getElementById("recoveryBanner")?.remove();
	document.body.insertAdjacentHTML(
		"afterbegin",
		`<div id="recoveryBanner" class="flexltr" hidden>
			<span id="recoveryBannerText" role="alert"></span>
			<span id="recoveryBannerWhen"></span>
			<span id="recoveryBannerError" role="alert" hidden></span>
			<button id="recoveryBannerCancel"></button>
		</div>`,
	);
	banner = document.getElementById("recoveryBanner") as HTMLDivElement;
	text = document.getElementById("recoveryBannerText") as HTMLSpanElement;
	when = document.getElementById("recoveryBannerWhen") as HTMLSpanElement;
	error = document.getElementById("recoveryBannerError") as HTMLSpanElement;
	cancel = document.getElementById("recoveryBannerCancel") as HTMLButtonElement;
});

afterEach(() => {
	for (const b of created.splice(0)) b.stop();
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.getElementById("recoveryBanner")?.remove();
	document.documentElement.style.removeProperty("--notice-height");
});

it("1. 404 leaves the bar hidden", async () => {
	vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, {status: 404}));

	await makeBanner().refresh();

	expect(banner.hidden).toBe(true);
});

it("2. Pending with null completes_at: visible, untimed text, #recoveryBannerWhen hidden", async () => {
	vi.spyOn(window, "fetch").mockResolvedValue(
		Response.json({status: "pending", completes_at: null}),
	);

	await makeBanner().refresh();

	expect(banner.hidden).toBe(false);
	expect(text.textContent).toBe(I18n.mfaRecovery.pending());
	expect(when.hidden).toBe(true);
	expect(when.textContent).toBe("");
	expect(cancel.textContent).toBe(I18n.mfaRecovery.cancel());
});

it("3. Pending with a date 72 h ahead: text holds the absolute date, countdown reads in 72 hours", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
	const target = new Date(Date.now() + 72 * 3_600_000);
	const expectedAbsolute = new Intl.DateTimeFormat(I18n.locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(target);
	vi.spyOn(window, "fetch").mockResolvedValue(
		Response.json({status: "pending", completes_at: target.toISOString()}),
	);

	await makeBanner().refresh();

	expect(banner.hidden).toBe(false);
	expect(text.textContent).toBe(I18n.mfaRecovery.pendingAt(expectedAbsolute));
	expect(when.hidden).toBe(false);
	expect(when.textContent).toBe("in 72 hours");
});

it("4. 90 seconds ahead reads in 2 minutes; a past date reads Any moment now", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
	const b = makeBanner();

	b.apply({status: "pending", completes_at: new Date(Date.now() + 90_000).toISOString()});
	expect(when.hidden).toBe(false);
	expect(when.textContent).toBe("in 2 minutes");

	b.apply({status: "pending", completes_at: new Date(Date.now() - 5_000).toISOString()});
	expect(when.hidden).toBe(false);
	expect(when.textContent).toBe(I18n.mfaRecovery.anyMoment());
});

it("5. An unparseable completes_at shows the untimed text", () => {
	const b = makeBanner();

	b.apply({status: "pending", completes_at: "not-a-valid-date"});

	expect(banner.hidden).toBe(false);
	expect(text.textContent).toBe(I18n.mfaRecovery.pending());
	expect(when.hidden).toBe(true);
	expect(when.textContent).toBe("");
});

it("6. The countdown ticks: 61 minutes ahead reads in 2 hours, and after advancing 2 minutes reads in 59 minutes; the alert span was not rewritten", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
	const b = makeBanner();
	b.apply({status: "pending", completes_at: new Date(Date.now() + 61 * 60_000).toISOString()});

	expect(when.textContent).toBe("in 2 hours");
	const initialTextNode = text.firstChild;
	expect(initialTextNode).not.toBeNull();
	let mutations = 0;
	const observer = new MutationObserver(() => {
		mutations++;
	});
	observer.observe(text, {childList: true, characterData: true, subtree: true});

	await vi.advanceTimersByTimeAsync(2 * 60_000);
	observer.disconnect();

	expect(when.textContent).toBe("in 59 minutes");
	expect(text.firstChild).toBe(initialTextNode);
	expect(mutations).toBe(0);
});

it("7. apply pending shows; cancelled hides; completed hides; an unknown status changes nothing", () => {
	const b = makeBanner();

	b.apply({status: "mystery"});
	expect(banner.hidden).toBe(true);

	b.apply({status: "pending", completes_at: null});
	expect(banner.hidden).toBe(false);

	b.apply({status: "mystery"});
	expect(banner.hidden).toBe(false);

	b.apply({status: "cancelled"});
	expect(banner.hidden).toBe(true);

	b.apply({status: "pending", completes_at: null});
	expect(banner.hidden).toBe(false);

	b.apply({status: "completed"});
	expect(banner.hidden).toBe(true);
});

it("8. apply pending without completes_at over a running countdown drops the countdown", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
	const b = makeBanner();
	b.apply({status: "pending", completes_at: new Date(Date.now() + 72 * 3_600_000).toISOString()});
	expect(when.hidden).toBe(false);
	expect(when.textContent).toBe("in 72 hours");

	b.apply({status: "pending"});

	expect(banner.hidden).toBe(false);
	expect(text.textContent).toBe(I18n.mfaRecovery.pending());
	expect(when.hidden).toBe(true);
	expect(when.textContent).toBe("");

	await vi.advanceTimersByTimeAsync(60_000);
	expect(when.hidden).toBe(true);
	expect(when.textContent).toBe("");
});

it("9. A GET resolving after apply({status:'cancelled'}) doesn't bring the bar back", async () => {
	let resolveGet!: (res: Response) => void;
	vi.spyOn(window, "fetch").mockImplementationOnce(
		() =>
			new Promise((r) => {
				resolveGet = r;
			}),
	);
	const b = makeBanner();

	const pendingRefresh = b.refresh();
	b.apply({status: "pending", completes_at: null});
	expect(banner.hidden).toBe(false);
	b.apply({status: "cancelled"});
	expect(banner.hidden).toBe(true);

	resolveGet(Response.json({status: "pending", completes_at: null}));
	await pendingRefresh;

	expect(banner.hidden).toBe(true);
});

it("10. Two refreshes: the first's late answer doesn't override the second's", async () => {
	let resolveFirst!: (res: Response) => void;
	let resolveSecond!: (res: Response) => void;
	vi.spyOn(window, "fetch")
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolveFirst = r;
				}),
		)
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolveSecond = r;
				}),
		);
	const b = makeBanner();

	const first = b.refresh();
	const second = b.refresh();

	resolveSecond(Response.json({status: "pending", completes_at: null}));
	await second;
	expect(banner.hidden).toBe(false);

	resolveFirst(new Response(null, {status: 404}));
	await first;
	expect(banner.hidden).toBe(false);
});

it("11. A GET resolving after stop() doesn't show; a later refresh() shows again", async () => {
	let resolveFirst!: (res: Response) => void;
	vi.spyOn(window, "fetch")
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolveFirst = r;
				}),
		)
		.mockResolvedValueOnce(Response.json({status: "pending", completes_at: null}));
	const b = makeBanner();

	const first = b.refresh();
	b.stop();
	resolveFirst(Response.json({status: "pending", completes_at: null}));
	await first;
	expect(banner.hidden).toBe(true);

	await b.refresh();
	expect(banner.hidden).toBe(false);
	expect(text.textContent).toBe(I18n.mfaRecovery.pending());
});

it("12. A 500 keeps a showing bar up and retries after 60 s; a 500 then 404 hides. A rejected fetch retries the same way. Only one retry fires per 60 s", async () => {
	vi.useFakeTimers();
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const fetchSpy = vi
		.spyOn(window, "fetch")
		.mockResolvedValueOnce(new Response("err", {status: 500}))
		.mockResolvedValueOnce(new Response(null, {status: 404}))
		.mockRejectedValueOnce(new TypeError("offline"))
		.mockRejectedValueOnce(new TypeError("offline"))
		.mockResolvedValueOnce(new Response(null, {status: 404}));

	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});
	expect(banner.hidden).toBe(false);

	await b.refresh();
	expect(banner.hidden).toBe(false);
	expect(fetchSpy).toHaveBeenCalledTimes(1);

	await vi.advanceTimersByTimeAsync(59_000);
	expect(fetchSpy).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(1_000);
	expect(fetchSpy).toHaveBeenCalledTimes(2);
	expect(banner.hidden).toBe(true);

	// Now test rejected fetch and that only one retry timer exists at a time.
	b.apply({status: "pending", completes_at: null});
	expect(banner.hidden).toBe(false);

	await b.refresh(); // Call 3: rejects, schedules retry at +60s
	expect(banner.hidden).toBe(false);
	expect(fetchSpy).toHaveBeenCalledTimes(3);

	await vi.advanceTimersByTimeAsync(20_000);
	await b.refresh(); // Call 4: rejects, replaces retry timer for +60s from now
	expect(fetchSpy).toHaveBeenCalledTimes(4);

	await vi.advanceTimersByTimeAsync(40_000); // 60s after Call 3, but only 40s after Call 4
	expect(fetchSpy).toHaveBeenCalledTimes(4);

	await vi.advanceTimersByTimeAsync(20_000); // 60s after Call 4 -> Call 5 (404)
	expect(fetchSpy).toHaveBeenCalledTimes(5);
	expect(banner.hidden).toBe(true);
});

it("13. A 401 keeps the bar as it is and doesn't retry", async () => {
	vi.useFakeTimers();
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, {status: 401}));
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	await b.refresh();

	expect(banner.hidden).toBe(false);
	expect(warn).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(120_000);
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it("14. stop() during a pending retry cancels it", async () => {
	vi.useFakeTimers();
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, {status: 500}));
	const b = makeBanner();

	await b.refresh();
	expect(fetchSpy).toHaveBeenCalledTimes(1);

	b.stop();
	await vi.advanceTimersByTimeAsync(120_000);
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it("15. Cancel on 204: DELETE to the exact URL with the headers, the button is disabled in flight, the bar hides", async () => {
	let resolveDelete!: (res: Response) => void;
	const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
		() =>
			new Promise((r) => {
				resolveDelete = r;
			}),
	);
	const b = makeBanner(API, () => ({Authorization: "tok-15"}));
	b.apply({status: "pending", completes_at: null});
	expect(cancel.disabled).toBe(false);

	cancel.click();

	expect(cancel.disabled).toBe(true);
	expect(fetchSpy).toHaveBeenCalledWith(URL_RECOVERY, {
		method: "DELETE",
		headers: {Authorization: "tok-15"},
	});

	resolveDelete(new Response(null, {status: 204}));
	await vi.waitFor(() => expect(banner.hidden).toBe(true));
});

it("16. Cancel on 404 hides", async () => {
	vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, {status: 404}));
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	cancel.click();

	await vi.waitFor(() => expect(banner.hidden).toBe(true));
});

it("17. Cancel on 500: the bar stays, the error shows, the button is enabled again; a second click clears the error while in flight", async () => {
	let resolveSecond!: (res: Response) => void;
	vi.spyOn(window, "fetch")
		.mockResolvedValueOnce(new Response(null, {status: 500}))
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolveSecond = r;
				}),
		);
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	cancel.click();
	await vi.waitFor(() => expect(error.hidden).toBe(false));
	expect(banner.hidden).toBe(false);
	expect(error.textContent).toBe(I18n.mfaRecovery.cancelFailed());
	expect(cancel.disabled).toBe(false);

	cancel.click();
	expect(error.hidden).toBe(true);
	expect(error.textContent).toBe("");
	expect(cancel.disabled).toBe(true);

	resolveSecond(new Response(null, {status: 204}));
	await vi.waitFor(() => expect(banner.hidden).toBe(true));
});

it("18. Cancel rejected by the network behaves as 17", async () => {
	let resolveSecond!: (res: Response) => void;
	vi.spyOn(window, "fetch")
		.mockRejectedValueOnce(new TypeError("Failed to fetch"))
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolveSecond = r;
				}),
		);
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	cancel.click();
	await vi.waitFor(() => expect(error.hidden).toBe(false));
	expect(banner.hidden).toBe(false);
	expect(error.textContent).toBe(I18n.mfaRecovery.cancelFailed());
	expect(cancel.disabled).toBe(false);

	cancel.click();
	expect(error.hidden).toBe(true);
	expect(error.textContent).toBe("");
	expect(cancel.disabled).toBe(true);

	resolveSecond(new Response(null, {status: 204}));
	await vi.waitFor(() => expect(banner.hidden).toBe(true));
});

it("19. An event cancelled during a failing DELETE: no error appears after the bar hid", async () => {
	let resolveDelete!: (res: Response) => void;
	vi.spyOn(window, "fetch").mockImplementationOnce(
		() =>
			new Promise((r) => {
				resolveDelete = r;
			}),
	);
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	cancel.click();
	b.apply({status: "cancelled"});
	expect(banner.hidden).toBe(true);

	resolveDelete(new Response(null, {status: 500}));
	await Promise.resolve();
	await Promise.resolve();

	expect(banner.hidden).toBe(true);
	expect(error.hidden).toBe(true);
	expect(error.textContent).toBe("");
});

it("20. A second instance's apply takes the button over: clicking sends only that instance's headers", async () => {
	const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, {status: 204}));
	const b1 = makeBanner(API, () => ({Authorization: "tok-first"}));
	const b2 = makeBanner(API, () => ({Authorization: "tok-second"}));

	b1.apply({status: "pending", completes_at: null});
	b2.apply({status: "pending", completes_at: null});
	cancel.click();

	await vi.waitFor(() => expect(banner.hidden).toBe(true));
	expect(fetchSpy).toHaveBeenCalledTimes(1);
	expect(fetchSpy).toHaveBeenCalledWith(URL_RECOVERY, {
		method: "DELETE",
		headers: {Authorization: "tok-second"},
	});
});

it("21. --notice-height equals the bar's offsetHeight px while shown and is removed once hidden", () => {
	const b = makeBanner();

	b.apply({status: "pending", completes_at: null});
	expect(banner.offsetHeight).toBeGreaterThan(0);
	expect(document.documentElement.style.getPropertyValue("--notice-height")).toBe(
		`${banner.offsetHeight}px`,
	);

	b.apply({status: "cancelled"});
	expect(document.documentElement.style.getPropertyValue("--notice-height")).toBe("");
});

it("22. Without the markup, refresh, apply and stop don't throw", async () => {
	document.getElementById("recoveryBanner")?.remove();
	vi.spyOn(window, "fetch").mockResolvedValue(
		Response.json({status: "pending", completes_at: new Date(Date.now() + 60_000).toISOString()}),
	);
	const b = makeBanner();

	await expect(b.refresh()).resolves.toBeUndefined();
	expect(() => b.apply({status: "pending", completes_at: null})).not.toThrow();
	expect(() => b.apply({status: "cancelled"})).not.toThrow();
	expect(() => b.stop()).not.toThrow();
});

it("23. Stylesheet: with ./public/style.css injected the hidden bar computes display: none, and showing it computes display: flex", async () => {
	const res = await fetch(new URL("./public/style.css", import.meta.url));
	expect(res.ok).toBe(true);
	const style = document.createElement("style");
	style.textContent = await res.text();
	document.head.append(style);
	try {
		expect(banner.hidden).toBe(true);
		expect(getComputedStyle(banner).display).toBe("none");

		const b = makeBanner();
		b.apply({status: "pending", completes_at: null});

		expect(banner.hidden).toBe(false);
		expect(getComputedStyle(banner).display).toBe("flex");
	} finally {
		style.remove();
	}
});

it("24. An old account's cancel answering after a switch leaves the new account's warning up", async () => {
	let resolveDelete!: (res: Response) => void;
	vi.spyOn(window, "fetch").mockImplementationOnce(
		() =>
			new Promise((r) => {
				resolveDelete = r;
			}),
	);
	const oldAccount = makeBanner(API, () => ({Authorization: "tok-old"}));
	oldAccount.apply({status: "pending", completes_at: null});
	cancel.click();

	oldAccount.stop();
	makeBanner(API, () => ({Authorization: "tok-new"})).apply({
		status: "pending",
		completes_at: null,
	});
	resolveDelete(new Response(null, {status: 204}));
	await new Promise((r) => setTimeout(r));

	expect(banner.hidden).toBe(false);
	expect(document.documentElement.style.getPropertyValue("--notice-height")).not.toBe("");
});

it("25. A pending event landing during a failing DELETE still leaves a usable button and says why", async () => {
	let resolveDelete!: (res: Response) => void;
	vi.spyOn(window, "fetch").mockImplementationOnce(
		() =>
			new Promise((r) => {
				resolveDelete = r;
			}),
	);
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});
	cancel.click();
	b.apply({status: "pending", completes_at: null});
	expect(cancel.disabled).toBe(true);

	resolveDelete(new Response(null, {status: 500}));
	await new Promise((r) => setTimeout(r));

	expect(cancel.disabled).toBe(false);
	expect(error.hidden).toBe(false);
	expect(error.textContent).toBe(I18n.mfaRecovery.cancelFailed());
});

it("26. Requests follow the session's current instance URL", async () => {
	const fetchSpy = vi
		.spyOn(window, "fetch")
		.mockImplementation(async () => new Response(null, {status: 404}));
	let api = "https://before.test/api/v9";
	const b = new RecoveryBanner(
		() => api,
		() => ({}),
	);
	created.push(b);

	await b.refresh();
	api = "https://after.test/api/v9";
	await b.refresh();

	expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
		"https://before.test/api/v9/users/@me/mfa/recovery",
		"https://after.test/api/v9/users/@me/mfa/recovery",
	]);
});

it("27. A 200 that isn't the route's answer (a portal's page, a stray body) leaves a showing warning up", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const b = makeBanner();
	b.apply({status: "pending", completes_at: null});

	vi.spyOn(window, "fetch").mockResolvedValueOnce(
		new Response("<html>sign in</html>", {status: 200}),
	);
	await b.refresh();
	expect(banner.hidden).toBe(false);

	vi.mocked(window.fetch).mockResolvedValueOnce(Response.json({status: "mystery"}));
	await b.refresh();
	expect(banner.hidden).toBe(false);
	expect(warn).toHaveBeenCalledTimes(2);
});
