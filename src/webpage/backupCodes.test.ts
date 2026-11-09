import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
const {showBackupCodes, REGEN_UNCHANGED} = await import("./backupCodes");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

const settled = (p: Promise<unknown>) =>
	Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 300))]);

function enterAndSubmitCode(prompt: HTMLElement, code: string) {
	const input = prompt.querySelector<HTMLInputElement>("input")!;
	input.value = code;
	input.dispatchEvent(new Event("input"));
	prompt.querySelector<HTMLButtonElement>("button")!.click();
}

describe("showBackupCodes screen", () => {
	it("renders codes in .backupCodeGrid, one per entry, for 2 entries and for 10", () => {
		showBackupCodes({
			backup_codes: [
				{code: "a1b2c3d4", consumed: false},
				{code: "e5f60718", consumed: false},
			],
		});
		expect(document.body.textContent).toContain(I18n.backupCodes.title());
		expect(document.body.textContent).toContain(I18n.backupCodes.explain());
		expect(
			[...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent),
		).toEqual(["a1b2c3d4", "e5f60718"]);

		document.body.replaceChildren();
		const ten = Array.from({length: 10}, (_, i) => ({
			code: `0123456${i}`,
			consumed: false,
		}));
		showBackupCodes({backup_codes: ten});
		expect(
			[...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent),
		).toEqual(ten.map((e) => e.code));
	});

	it("shows nothing for non-array inputs; any array answer with no usable codes says there are none", () => {
		for (const input of [undefined, {}, {backup_codes: "x"}]) {
			expect(() => showBackupCodes(input)).not.toThrow();
			expect(document.querySelector(".backupCodeGrid")).toBeNull();
			expect(document.querySelector(".background")).toBeNull();
		}
		document.body.replaceChildren();
		// Empty, junk, or all consumed: the array is the answer, so it says so.
		for (const input of [
			{backup_codes: []},
			{backup_codes: [{consumed: false}]},
			{backup_codes: [{code: "", consumed: false}]},
			{backup_codes: [{code: "12345678", consumed: true}]},
		]) {
			expect(() => showBackupCodes(input)).not.toThrow();
			expect(document.body.textContent).toContain(I18n.backupCodes.none());
			expect(document.querySelector(".backupCodeGrid")).toBeNull();
			document.body.replaceChildren();
		}

		showBackupCodes({
			backup_codes: [
				{consumed: false},
				{code: "", consumed: false},
				{code: "11112222", consumed: true},
				{code: "33334444", consumed: false},
				null,
				{code: 99999999, consumed: false},
				{code: "55556666"},
			],
		});
		expect(
			[...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent),
		).toEqual(["33334444", "55556666"]);
	});

	it("a valid empty answer says there are no codes instead of doing nothing", () => {
		showBackupCodes({backup_codes: []});
		expect(document.body.textContent).toContain(I18n.backupCodes.none());
		expect(document.body.textContent).not.toContain(I18n.backupCodes.noneRegenerate());
		expect(document.querySelector(".backupCodeGrid")).toBeNull();
	});

	it("the none screen with a regenerate callback shows noneRegenerate", () => {
		showBackupCodes({backup_codes: []}, {regenerate: async () => null});
		expect(document.body.textContent).toContain(I18n.backupCodes.none());
		expect(document.body.textContent).toContain(I18n.backupCodes.noneRegenerate());
	});

	it("without view: true, the grid shows explain and not viewExplain", () => {
		showBackupCodes({
			backup_codes: [{code: "a1b2c3d4", consumed: false}],
		});
		expect(document.body.textContent).toContain(I18n.backupCodes.explain());
		expect(document.body.textContent).not.toContain(I18n.backupCodes.viewExplain());
	});

	it("view: true shows viewExplain and not explain", () => {
		showBackupCodes({backup_codes: [{code: "a1b2c3d4", consumed: false}]}, {view: true});
		expect(document.body.textContent).toContain(I18n.backupCodes.viewExplain());
		expect(document.body.textContent).not.toContain(I18n.backupCodes.explain());
	});

	it("leaves the screen up on Escape and background click, and removes it on Done", async () => {
		showBackupCodes({
			backup_codes: [{code: "a1b2c3d4", consumed: false}],
		});
		const bg = document.querySelector<HTMLElement>(".background")!;
		expect(bg.classList.contains("solidBackground")).toBe(true);
		expect(bg.style.zIndex).toBe("200");

		bg.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		bg.click();
		expect(document.querySelector(".backupCodeGrid")).not.toBeNull();
		expect(bg.classList.contains("removeElm")).toBe(false);

		const doneBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === I18n.backupCodes.done(),
		)!;
		doneBtn.click();

		await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
	});

	it("Copy writes newline-joined codes and shows copied; a rejected write shows copyFailed in the dialog and stays open", async () => {
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
		showBackupCodes({
			backup_codes: [
				{code: "aaaa1111", consumed: false},
				{code: "bbbb2222", consumed: false},
			],
		});
		const bg = document.querySelector<HTMLElement>(".background")!;
		const copyBtn = [...bg.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === I18n.backupCodes.copy(),
		)!;

		copyBtn.click();
		await vi.waitFor(() => expect(bg.textContent).toContain(I18n.backupCodes.copied()));
		expect(writeText).toHaveBeenCalledWith("aaaa1111\nbbbb2222");

		writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
		copyBtn.click();
		await vi.waitFor(() => expect(bg.textContent).toContain(I18n.backupCodes.copyFailed()));
		expect(document.querySelector(".PopUp")).toBeNull();
		expect(document.querySelector(".backupCodeGrid")).not.toBeNull();
	});

	it("Download produces a text/plain Blob of the codes with a trailing newline", async () => {
		const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup-codes");
		const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		let downloadName = "";
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadName = this.download;
		});

		showBackupCodes({
			backup_codes: [
				{code: "aaaa1111", consumed: false},
				{code: "bbbb2222", consumed: false},
			],
		});
		const downloadBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === I18n.backupCodes.download(),
		)!;
		downloadBtn.click();

		expect(createUrl).toHaveBeenCalledOnce();
		const blob = createUrl.mock.calls[0]![0] as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe("text/plain");
		expect(await blob.text()).toBe("aaaa1111\nbbbb2222\n");
		expect(downloadName).toBe("machloket-backup-codes.txt");
		expect(revokeUrl).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:backup-codes"), {
			timeout: 2000,
		});
		clickSpy.mockRestore();
	});

	describe("regenerate callback", () => {
		const codesNow = () =>
			[...document.querySelectorAll(".backupCodeGrid code")].map((c) => c.textContent);
		const regenButton = () =>
			[...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.textContent === I18n.backupCodes.regenerate(),
			);

		it("without a callback there is no regenerate button", () => {
			showBackupCodes({backup_codes: [{code: "aaaa1111", consumed: false}]});
			expect(regenButton()).toBeUndefined();
		});

		it("regenerating re-renders the grid with the new codes and copy follows them", async () => {
			const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => ({
						backup_codes: [
							{code: "new22222", consumed: false},
							{code: "new33333", consumed: false},
						],
					}),
				},
			);
			expect(codesNow()).toEqual(["old11111"]);

			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222", "new33333"]));

			const copyBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.textContent === I18n.backupCodes.copy(),
			)!;
			copyBtn.click();
			await vi.waitFor(() =>
				expect(document.body.textContent).toContain(I18n.backupCodes.copied()),
			);
			expect(writeText).toHaveBeenLastCalledWith("new22222\nnew33333");
		});

		it("a successful regenerate clears a stale copied note", async () => {
			const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{regenerate: async () => ({backup_codes: [{code: "new22222", consumed: false}]})},
			);
			const copyBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.textContent === I18n.backupCodes.copy(),
			)!;
			copyBtn.click();
			await vi.waitFor(() =>
				expect(document.body.textContent).toContain(I18n.backupCodes.copied()),
			);
			expect(writeText).toHaveBeenLastCalledWith("old11111");

			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222"]));
			// the note was about the old batch; it must not read as covering the new one
			expect(document.body.textContent).not.toContain(I18n.backupCodes.copied());
		});

		it("a refused regenerate (null) closes the grid: the old codes may already be expired", async () => {
			let refused = false;
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: () => {
						refused = true;
						return null;
					},
				},
			);

			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			await vi.waitFor(() => expect(refused).toBe(true));
			// hide() detaches after removeAni's animation race, so wait for the detach
			// rather than reading the DOM on the next microtask.
			await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
		});

		it("an empty answer with a callback offers regenerating into a full screen", async () => {
			showBackupCodes(
				{backup_codes: []},
				{regenerate: async () => ({backup_codes: [{code: "nEwC0de9", consumed: false}]})},
			);
			expect(document.body.textContent).toContain(I18n.backupCodes.none());
			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["nEwC0de9"]));
		});

		it("a regenerate that throws closes the grid and leaves no button disabled", async () => {
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => {
						throw new Error("boom");
					},
				},
			);
			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			// A throw can't say whether the server expired the old batch: same as null.
			await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
			expect(btn!.disabled).toBe(false);
		});

		it("an unchanged answer keeps the grid and the old codes", async () => {
			let answered = false;
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => {
						answered = true;
						return REGEN_UNCHANGED;
					},
				},
			);
			const btn = regenButton();
			btn!.click();
			await vi.waitFor(() => expect(answered).toBe(true));
			// The finally re-enables the button: the handler has run to its end.
			await vi.waitFor(() => expect(btn!.disabled).toBe(false));
			expect(codesNow()).toEqual(["old11111"]);
			// hide() marks the background synchronously (removeAni's removeElm) and detaches
			// it only after the animation race, so the marker is the prompt signal.
			expect(document.querySelector(".backupCodeGrid")?.closest(".removeElm")).toBeNull();
			expect(document.querySelector(".backupCodeGrid")).not.toBeNull();
		});

		it("one tap sends one regenerate however often it is clicked", async () => {
			let calls = 0;
			let release: (() => void) | undefined;
			const gate = new Promise<void>((r) => (release = r));
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: () => {
						calls++;
						return gate.then(() => ({backup_codes: [{code: "new22222", consumed: false}]}));
					},
				},
			);
			const btn = regenButton();
			expect(btn, "no regenerate button").toBeDefined();
			btn!.click();
			// The button is disabled now, so click() would be ignored; call the handler
			// directly so the in-flight flag stays pinned on its own.
			btn!.onclick!(new PointerEvent("click"));
			btn!.onclick!(new PointerEvent("click"));
			expect(calls).toBe(1);
			release!();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222"]));
		});

		it("a regenerate that throws synchronously closes the grid and leaves no button disabled", async () => {
			const rejections: string[] = [];
			const onRejection = (e: PromiseRejectionEvent) => {
				rejections.push(String(e.reason));
				e.preventDefault();
			};
			window.addEventListener("unhandledrejection", onRejection);
			try {
				showBackupCodes(
					{backup_codes: [{code: "old11111", consumed: false}]},
					{
						regenerate: () => {
							throw new Error("sync boom");
						},
					},
				);
				const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
				const btn = regenButton();
				expect(btn, "no regenerate button").toBeDefined();
				btn!.click();
				await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
				void Promise.reject(new Error("sentinel"));
				await vi.waitFor(() => expect(rejections).toContain("Error: sentinel"));
				expect(rejections).toEqual(["Error: sentinel"]);
				for (const b of buttons) {
					expect(b.disabled).toBe(false);
				}
			} finally {
				window.removeEventListener("unhandledrejection", onRejection);
			}
		});

		it("a regenerate that throws synchronously on the none dialog produces no unhandled rejection and leaves its buttons enabled", async () => {
			const rejections: string[] = [];
			const onRejection = (e: PromiseRejectionEvent) => {
				rejections.push(String(e.reason));
				e.preventDefault();
			};
			window.addEventListener("unhandledrejection", onRejection);
			try {
				showBackupCodes(
					{backup_codes: []},
					{
						regenerate: () => {
							throw new Error("sync boom");
						},
					},
				);
				const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
				const btn = regenButton();
				expect(btn, "no regenerate button").toBeDefined();
				btn!.click();
				await vi.waitFor(() => expect(btn!.getAttribute("aria-busy")).toBeNull());
				void Promise.reject(new Error("sentinel"));
				await vi.waitFor(() => expect(rejections).toContain("Error: sentinel"));
				expect(rejections).toEqual(["Error: sentinel"]);
				for (const b of buttons) {
					expect(b.disabled).toBe(false);
				}
			} finally {
				window.removeEventListener("unhandledrejection", onRejection);
			}
		});

		it("disables Done and Regenerate on the none dialog while a regenerate is pending, then re-enables them", async () => {
			let release!: () => void;
			const gate = new Promise<void>((r) => (release = r));
			showBackupCodes(
				{backup_codes: []},
				{
					regenerate: () => gate.then(() => null),
				},
			);
			const doneBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(b) => b.textContent === I18n.backupCodes.done(),
			)!;
			const btn = regenButton()!;
			expect(doneBtn).toBeDefined();
			expect(btn).toBeDefined();

			btn.click();
			expect(doneBtn.disabled).toBe(true);
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute("aria-busy")).toBe("true");

			release();
			await vi.waitFor(() => expect(doneBtn.disabled).toBe(false));
			expect(btn.disabled).toBe(false);
			expect(btn.getAttribute("aria-busy")).toBeNull();
		});

		it("restores focus to the Regenerate button after a regenerate settles with the grid still open", async () => {
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => ({
						backup_codes: [{code: "new22222", consumed: false}],
					}),
				},
			);
			const btn = regenButton()!;
			// A real tap focuses the button; disabling it in flight then drops focus.
			btn.focus();
			btn.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222"]));
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.activeElement).toBe(btn);
		});

		it("leaves focus on a refusal dialog opened over the grid", async () => {
			let refusal!: HTMLButtonElement;
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => {
						// Stands in for showRefusal: another dialog takes focus on top.
						refusal = document.createElement("button");
						document.body.append(refusal);
						refusal.focus();
						return REGEN_UNCHANGED;
					},
				},
			);
			const btn = regenButton()!;
			btn.click();
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.activeElement, "focus moved back under the refusal").toBe(refusal);
		});

		/** Stands in for an MFA prompt that took focus and is fading out when the action settles. */
		const fadingPromptTakesFocus = () => {
			const prompt = document.createElement("div");
			prompt.classList.add("removeElm");
			const field = document.createElement("input");
			prompt.append(field);
			document.body.append(prompt);
			field.focus();
		};

		it("takes focus back from a prompt that is fading out (grid)", async () => {
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => {
						fadingPromptTakesFocus();
						return REGEN_UNCHANGED;
					},
				},
			);
			const btn = regenButton()!;
			btn.click();
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.activeElement, "focus stranded in a closing prompt").toBe(btn);
		});

		it("takes focus back from a prompt that is fading out (no codes on screen)", async () => {
			showBackupCodes(
				{backup_codes: []},
				{
					regenerate: async () => {
						fadingPromptTakesFocus();
						return null;
					},
				},
			);
			const btn = regenButton()!;
			btn.click();
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.activeElement, "focus stranded in a closing prompt").toBe(btn);
		});

		it("the no-codes screen never refocuses its own Regenerate once new codes replace it", async () => {
			showBackupCodes(
				{backup_codes: []},
				{regenerate: async () => ({backup_codes: [{code: "new22222", consumed: false}]})},
			);
			const btn = regenButton()!;
			const focused: Element[] = [];
			btn.addEventListener("focus", () => focused.push(btn));
			btn.click();
			await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).not.toBeNull());
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(focused, "the closing screen took focus").toEqual([]);
		});

		it("does not focus the Regenerate button of a grid that is closing", async () => {
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{regenerate: async () => null},
			);
			const btn = regenButton()!;
			const focused: Element[] = [];
			btn.addEventListener("focus", () => focused.push(btn));
			btn.click();
			await vi.waitFor(() => expect(btn.closest(".removeElm")).not.toBeNull());
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(focused, "a closing grid took focus").toEqual([]);
		});

		it("after a successful regenerate on a view: true grid, explain replaces viewExplain", async () => {
			// The not.toContain checks in these view tests need neither text to contain the other.
			expect(I18n.backupCodes.explain()).not.toContain(I18n.backupCodes.viewExplain());
			expect(I18n.backupCodes.viewExplain()).not.toContain(I18n.backupCodes.explain());
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					view: true,
					regenerate: async () => ({
						backup_codes: [{code: "new22222", consumed: false}],
					}),
				},
			);
			expect(document.body.textContent).toContain(I18n.backupCodes.viewExplain());
			expect(document.body.textContent).not.toContain(I18n.backupCodes.explain());

			regenButton()!.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222"]));
			expect(document.body.textContent).toContain(I18n.backupCodes.explain());
			expect(document.body.textContent).not.toContain(I18n.backupCodes.viewExplain());
		});

		it("the none screen's regenerate opens a grid showing explain", async () => {
			showBackupCodes(
				{backup_codes: []},
				{
					view: true,
					regenerate: async () => ({
						backup_codes: [{code: "nEwC0de9", consumed: false}],
					}),
				},
			);
			regenButton()!.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["nEwC0de9"]));
			expect(document.body.textContent).toContain(I18n.backupCodes.explain());
			expect(document.body.textContent).not.toContain(I18n.backupCodes.viewExplain());
		});

		it.each([
			["resolving null", async () => null],
			[
				"rejecting",
				async () => {
					throw new Error("boom");
				},
			],
		])(
			"a regenerate %s on the grid shows regenLost after .backupCodeGrid is gone",
			async (_, regenerate) => {
				showBackupCodes({backup_codes: [{code: "old11111", consumed: false}]}, {regenerate});
				expect(document.body.textContent).not.toContain(I18n.backupCodes.regenLost());
				regenButton()!.click();
				await vi.waitFor(() => expect(document.querySelector(".backupCodeGrid")).toBeNull());
				expect(document.body.textContent).toContain(I18n.backupCodes.regenLost());
			},
		);

		it("REGEN_UNCHANGED and a successful new batch show no regenLost", async () => {
			let step = 0;
			showBackupCodes(
				{backup_codes: [{code: "old11111", consumed: false}]},
				{
					regenerate: async () => {
						step++;
						return step === 1
							? REGEN_UNCHANGED
							: {backup_codes: [{code: "new22222", consumed: false}]};
					},
				},
			);
			const btn = regenButton()!;
			btn.click();
			await vi.waitFor(() => expect(step).toBe(1));
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.body.textContent).not.toContain(I18n.backupCodes.regenLost());

			btn.click();
			await vi.waitFor(() => expect(codesNow()).toEqual(["new22222"]));
			await vi.waitFor(() => expect(btn.disabled).toBe(false));
			expect(document.body.textContent).not.toContain(I18n.backupCodes.regenLost());
		});
	});
});

describe("login 2FA and backup code entry", () => {
	const TOTP_LOGIN_URL = "http://tfa.test/api/v9/auth/login";
	const TOTP_VERIFY_URL = "http://tfa.test/api/auth/mfa/totp";

	it("TOTP ticket shows loginHint with 2FA code: title when backup is true, and no hint when backup is absent", async () => {
		captureRequests(TOTP_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, totp: true, ticket: "t1", backup: true}),
		);
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: TOTP_LOGIN_URL,
			method: "POST",
		});
		form.addTextInput("Login", "login", {initText: "nyx@example.invalid"});

		const submit1 = form.submit();
		const prompt1 = await vi.waitFor(() => {
			const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
			expect(p?.textContent).toContain("2FA code:");
			return p!;
		});
		expect(prompt1.textContent).toContain(I18n.backupCodes.loginHint());
		prompt1.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		expect(await settled(submit1)).toBe("settled");

		document.body.replaceChildren();
		captureRequests(TOTP_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, totp: true, ticket: "t2"}),
		);
		const form2 = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: TOTP_LOGIN_URL,
			method: "POST",
		});
		form2.addTextInput("Login", "login", {initText: "nyx@example.invalid"});

		const submit2 = form2.submit();
		const prompt2 = await vi.waitFor(() => {
			const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
			expect(p?.textContent).toContain("2FA code:");
			return p!;
		});
		expect(prompt2.textContent).not.toContain(I18n.backupCodes.loginHint());
		prompt2.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		expect(await settled(submit2)).toBe("settled");
	});

	it("normalizes login codes by stripping whitespace and dashes and lowercasing, while 6-digit TOTP passes through", async () => {
		captureRequests(TOTP_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, totp: true, ticket: "t-norm", backup: true}),
		);
		const totpSent = captureRequests(TOTP_VERIFY_URL, () => Response.json({token: "tok-1"}));

		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: TOTP_LOGIN_URL,
			method: "POST",
		});
		form.addTextInput("Login", "login", {initText: "nyx@example.invalid"});

		const submit1 = form.submit();
		const prompt1 = await vi.waitFor(() => {
			const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
			expect(p?.textContent).toContain("2FA code:");
			return p!;
		});
		enterAndSubmitCode(prompt1, " AB-CD 1234 ");
		await submit1;
		expect(totpSent).toEqual([{code: "abcd1234", ticket: "t-norm"}]);
		expect(loggedIn).toHaveBeenCalledWith({token: "tok-1"}, {login: "nyx@example.invalid"});

		document.body.replaceChildren();
		const form2 = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: TOTP_LOGIN_URL,
			method: "POST",
		});
		form2.addTextInput("Login", "login", {initText: "nyx@example.invalid"});

		const submit2 = form2.submit();
		const prompt2 = await vi.waitFor(() => {
			const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
			expect(p?.textContent).toContain("2FA code:");
			return p!;
		});
		enterAndSubmitCode(prompt2, "123456");
		await submit2;
		expect(totpSent).toEqual([
			{code: "abcd1234", ticket: "t-norm"},
			{code: "123456", ticket: "t-norm"},
		]);
	});

	const KEY_API = "http://key.test/api";
	const KEY_LOGIN_URL = KEY_API + "/v9/auth/login";
	const KEY_WEBAUTHN_URL = KEY_API + "/auth/mfa/webauthn";
	const KEY_TOTP_URL = KEY_API + "/auth/mfa/totp";
	const challenge = JSON.stringify({
		publicKey: {challenge: "abc=", allowCredentials: [{id: "id=", type: "public-key"}]},
	});

	it("WebAuthn ticket with backup: true and rejected navigator.credentials.get opens keyPromptTitle code prompt and completes login", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, webauthn: challenge, ticket: "tk-1", backup: true}),
		);
		const totpSent = captureRequests(KEY_TOTP_URL, () => Response.json({token: "tok-from-backup"}));
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const getKey = vi
			.spyOn(navigator.credentials, "get")
			.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: KEY_LOGIN_URL,
			method: "POST",
		});

		try {
			const submit = form.submit();
			const prompt = await vi.waitFor(() => {
				const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
				expect(p?.textContent).toContain(I18n.backupCodes.keyPromptTitle());
				return p!;
			});
			expect(prompt.textContent).toContain(I18n.backupCodes.keyPromptHint());
			enterAndSubmitCode(prompt, "DEAD-BEEF");
			await submit;

			expect(totpSent).toEqual([{code: "deadbeef", ticket: "tk-1"}]);
			expect(loggedIn).toHaveBeenCalledWith({token: "tok-from-backup"}, {});
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});

	it("WebAuthn ticket with backup: true and throwing parseRequestOptionsFromJSON opens the same code prompt", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, webauthn: challenge, ticket: "tk-2", backup: true}),
		);
		const totpSent = captureRequests(KEY_TOTP_URL, () => Response.json({token: "tok-from-throw"}));
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {
				parseRequestOptionsFromJSON: () => {
					throw new TypeError("Invalid challenge");
				},
			},
		});
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: KEY_LOGIN_URL,
			method: "POST",
		});

		try {
			const submit = form.submit();
			const prompt = await vi.waitFor(() => {
				const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
				expect(p?.textContent).toContain(I18n.backupCodes.keyPromptTitle());
				return p!;
			});
			expect(prompt.textContent).toContain(I18n.backupCodes.keyPromptHint());
			enterAndSubmitCode(prompt, "11223344");
			await submit;

			expect(totpSent).toEqual([{code: "11223344", ticket: "tk-2"}]);
			expect(loggedIn).toHaveBeenCalledWith({token: "tok-from-throw"}, {});
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
		}
	});

	it("WebAuthn ticket with backup false or absent and cancelled key opens no code prompt and settles without calling onSubmit", async () => {
		const totpSent = captureRequests(KEY_TOTP_URL, () => Response.json({token: "unused"}));
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const getKey = vi
			.spyOn(navigator.credentials, "get")
			.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));

		try {
			for (const body of [
				{token: null, mfa: true, webauthn: challenge, ticket: "tk-false", backup: false},
				{token: null, mfa: true, webauthn: challenge, ticket: "tk-absent"},
			]) {
				captureRequests(KEY_LOGIN_URL, () => Response.json(body));
				const loggedIn = vi.fn();
				const form = new Dialog("").options.addForm("", loggedIn, {
					fetchURL: KEY_LOGIN_URL,
					method: "POST",
				});

				await expect(form.submit()).resolves.toBeUndefined();
				expect(document.querySelector(".background")).toBeNull();
				expect(loggedIn).not.toHaveBeenCalled();
				expect(totpSent).toHaveLength(0);
			}
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});

	it("refused WebAuthn assertion appends retryLogin when backup is true and does not open a code prompt; omits retryLogin when backup is false", async () => {
		const totpSent = captureRequests(KEY_TOTP_URL, () => Response.json({token: "unused"}));
		captureRequests(KEY_WEBAUTHN_URL, () =>
			Response.json({message: "Invalid security key", code: 60008}, {status: 400}),
		);
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const buffer = () => new Uint8Array([1, 2]).buffer;
		const getKey = vi.spyOn(navigator.credentials, "get").mockResolvedValue({
			rawId: buffer(),
			response: {authenticatorData: buffer(), clientDataJSON: buffer(), signature: buffer()},
		} as never);

		try {
			captureRequests(KEY_LOGIN_URL, () =>
				Response.json({
					token: null,
					mfa: true,
					webauthn: challenge,
					ticket: "tk-ref1",
					backup: true,
				}),
			);
			const loggedIn = vi.fn();
			const form1 = new Dialog("").options.addForm("", loggedIn, {
				fetchURL: KEY_LOGIN_URL,
				method: "POST",
			});
			await form1.submit();

			expect(document.body.textContent).toContain(
				"Invalid security key " + I18n.backupCodes.retryLogin(),
			);
			expect(document.body.textContent).not.toContain(I18n.backupCodes.keyPromptTitle());
			expect(loggedIn).not.toHaveBeenCalled();
			expect(totpSent).toHaveLength(0);

			document.body.replaceChildren();
			captureRequests(KEY_LOGIN_URL, () =>
				Response.json({
					token: null,
					mfa: true,
					webauthn: challenge,
					ticket: "tk-ref2",
					backup: false,
				}),
			);
			const form2 = new Dialog("").options.addForm("", loggedIn, {
				fetchURL: KEY_LOGIN_URL,
				method: "POST",
			});
			await form2.submit();

			expect(document.body.textContent).toContain("Invalid security key");
			expect(document.body.textContent).not.toContain(I18n.backupCodes.retryLogin());
			expect(loggedIn).not.toHaveBeenCalled();
			expect(totpSent).toHaveLength(0);
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});

	describe("the key prompt's fallback follows what the login answer says can finish it", () => {
		async function cancelKeyWith(answer: {totp?: boolean; backup?: boolean}) {
			captureRequests(KEY_LOGIN_URL, () =>
				Response.json({token: null, mfa: true, webauthn: challenge, ticket: "tk-f", ...answer}),
			);
			const totpSent = captureRequests(KEY_TOTP_URL, () => Response.json({token: "tok-code"}));
			const realKey = globalThis.PublicKeyCredential;
			Object.assign(globalThis, {
				PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
			});
			const getKey = vi
				.spyOn(navigator.credentials, "get")
				.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
			const loggedIn = vi.fn();
			const form = new Dialog("").options.addForm("", loggedIn, {
				fetchURL: KEY_LOGIN_URL,
				method: "POST",
			});
			return {
				form,
				totpSent,
				loggedIn,
				restore() {
					Object.assign(globalThis, {PublicKeyCredential: realKey});
					getKey.mockRestore();
				},
			};
		}

		it.each([
			["totp only", {totp: true, backup: false}, "keyPromptTotpTitle", "keyPromptTotpHint"],
			["totp, flag for backup absent", {totp: true}, "keyPromptTotpTitle", "keyPromptTotpHint"],
			["both", {totp: true, backup: true}, "keyPromptEitherTitle", "keyPromptEitherHint"],
			["backup only", {totp: false, backup: true}, "keyPromptTitle", "keyPromptHint"],
		] as const)("%s", async (_name, answer, title, hint) => {
			const {form, totpSent, loggedIn, restore} = await cancelKeyWith(answer);
			try {
				const submit = form.submit();
				const prompt = await vi.waitFor(() => {
					const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
					expect(p?.textContent).toContain(I18n.backupCodes[title]());
					return p!;
				});
				expect(prompt.textContent).toContain(I18n.backupCodes[hint]());
				enterAndSubmitCode(prompt, "123456");
				await submit;
				expect(totpSent).toEqual([{code: "123456", ticket: "tk-f"}]);
				expect(loggedIn).toHaveBeenCalledWith({token: "tok-code"}, {});
			} finally {
				restore();
			}
		});

		it("totp: false and no backup offers nothing", async () => {
			const {form, loggedIn, restore} = await cancelKeyWith({totp: false, backup: false});
			try {
				await expect(form.submit()).resolves.toBeUndefined();
				expect(document.querySelector(".background")).toBeNull();
				expect(loggedIn).not.toHaveBeenCalled();
			} finally {
				restore();
			}
		});
	});

	it("a refused assertion on an account with an authenticator says a code can finish it", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, webauthn: challenge, ticket: "tk-r", totp: true}),
		);
		captureRequests(KEY_WEBAUTHN_URL, () =>
			Response.json({message: "Invalid security key", code: 60008}, {status: 400}),
		);
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const buffer = () => new Uint8Array([1, 2]).buffer;
		const getKey = vi.spyOn(navigator.credentials, "get").mockResolvedValue({
			rawId: buffer(),
			response: {authenticatorData: buffer(), clientDataJSON: buffer(), signature: buffer()},
		} as never);
		try {
			await new Dialog("").options
				.addForm("", vi.fn(), {fetchURL: KEY_LOGIN_URL, method: "POST"})
				.submit();
			expect(document.body.textContent).toContain(
				"Invalid security key " + I18n.backupCodes.retryLoginCode(),
			);
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});

	it("a key prompt that can't run and no code to fall back on says why instead of doing nothing", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, webauthn: "not json", ticket: "tk-u"}),
		);
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await new Dialog("").options
				.addForm("", vi.fn(), {fetchURL: KEY_LOGIN_URL, method: "POST"})
				.submit();
			expect(document.body.textContent).toContain(I18n.backupCodes.keyUnavailable());
		} finally {
			errors.mockRestore();
		}
	});

	it("a key prompt that can't run with a code to fall back on says why the code is being asked for", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({token: null, mfa: true, webauthn: "not json", ticket: "tk-w", totp: true}),
		);
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			void new Dialog("").options
				.addForm("", vi.fn(), {fetchURL: KEY_LOGIN_URL, method: "POST"})
				.submit();
			await vi.waitFor(() =>
				expect(document.body.textContent).toContain(I18n.backupCodes.keyPromptTotpHint()),
			);
			expect(document.body.textContent).toContain(I18n.backupCodes.keyUnavailable());
		} finally {
			errors.mockRestore();
		}
	});

	it("WebAuthn fallback code prompt shows 400 message in .suberror, stays open, and retries with the same ticket", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({
				token: null,
				mfa: true,
				webauthn: challenge,
				ticket: "tk-retry",
				backup: true,
			}),
		);
		let attempt = 0;
		const totpSent = captureRequests(KEY_TOTP_URL, () => {
			attempt++;
			return attempt === 1
				? Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400})
				: Response.json({token: "tok-second-try"});
		});
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const getKey = vi
			.spyOn(navigator.credentials, "get")
			.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: KEY_LOGIN_URL,
			method: "POST",
		});

		try {
			const submit = form.submit();
			const prompt = await vi.waitFor(() => {
				const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
				expect(p?.textContent).toContain(I18n.backupCodes.keyPromptTitle());
				return p!;
			});

			enterAndSubmitCode(prompt, "bad00001");
			await vi.waitFor(() =>
				expect(prompt.querySelector(".suberror")?.textContent).toBe("Invalid two-factor code"),
			);
			expect(loggedIn).not.toHaveBeenCalled();

			enterAndSubmitCode(prompt, "good0002");
			await submit;

			expect(totpSent).toEqual([
				{code: "bad00001", ticket: "tk-retry"},
				{code: "good0002", ticket: "tk-retry"},
			]);
			expect(loggedIn).toHaveBeenCalledWith({token: "tok-second-try"}, {});
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});

	it("dismissing the key-path code prompt settles the submit without calling onSubmit", async () => {
		captureRequests(KEY_LOGIN_URL, () =>
			Response.json({
				token: null,
				mfa: true,
				webauthn: challenge,
				ticket: "tk-dismiss",
				backup: true,
			}),
		);
		const realKey = globalThis.PublicKeyCredential;
		Object.assign(globalThis, {
			PublicKeyCredential: {parseRequestOptionsFromJSON: (options: unknown) => options},
		});
		const getKey = vi
			.spyOn(navigator.credentials, "get")
			.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {
			fetchURL: KEY_LOGIN_URL,
			method: "POST",
		});

		try {
			const submit = form.submit();
			const prompt = await vi.waitFor(() => {
				const p = [...document.querySelectorAll<HTMLElement>(".background")].at(-1);
				expect(p?.textContent).toContain(I18n.backupCodes.keyPromptTitle());
				return p!;
			});
			prompt.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

			expect(await settled(submit)).toBe("settled");
			expect(loggedIn).not.toHaveBeenCalled();
		} finally {
			Object.assign(globalThis, {PublicKeyCredential: realKey});
			getKey.mockRestore();
		}
	});
});
