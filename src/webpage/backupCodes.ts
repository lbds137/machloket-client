import {Dialog} from "./settings";
import {I18n} from "./i18n";

type BackupCodeEntry = {code?: unknown; consumed?: unknown};

/** The unconsumed, non-empty code strings in a codes-verification answer. */
export function codesOf(answer: unknown): string[] {
	const raw = (answer as {backup_codes?: unknown} | null | undefined)?.backup_codes;
	if (!Array.isArray(raw)) return [];
	const codes: string[] = [];
	for (const entry of raw) {
		if (
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as BackupCodeEntry).code === "string" &&
			((entry as BackupCodeEntry).code as string).length > 0 &&
			(entry as BackupCodeEntry).consumed !== true
		) {
			codes.push((entry as BackupCodeEntry).code as string);
		}
	}
	return codes;
}

/** What a regenerate callback returns when the server refused before expiring anything (a
 * 4xx): the codes on screen are still the valid ones, so the grid stays as it is. */
export const REGEN_UNCHANGED: unique symbol = Symbol("regen-unchanged");

/**
 * Disabling the focused Regenerate dropped focus to body; give it back once the
 * action settles. Never to a dialog that is closing, and never away from a live
 * dialog opened on top (a refusal); a prompt that is itself fading out lets go of
 * it. Body counts as free even when the user put focus there (the two can't be
 * told apart); returning focus inside the still-open dialog is intended.
 */
function refocus(dialog: Dialog, el: HTMLElement | undefined) {
	if (!el?.isConnected || el.closest(".removeElm")) return;
	const active = document.activeElement;
	const free =
		!active ||
		active === document.body ||
		!!dialog.background.deref()?.contains(active) ||
		!!active.closest(".removeElm");
	if (free) el.focus();
}

type Btn = ReturnType<Dialog["options"]["addButtonInput"]>;

/**
 * Both screens' regenerate: lock `buttons` and mark Regenerate busy (synchronously,
 * before the first await), run, then unlock and give focus back.
 */
async function withBusy(
	dialog: Dialog,
	regenBtn: Btn,
	buttons: readonly Btn[],
	run: () => Promise<void>,
): Promise<void> {
	for (const btn of buttons) {
		if (btn.buttonHtml) btn.buttonHtml.disabled = true;
	}
	if (regenBtn.buttonHtml) {
		regenBtn.buttonHtml.setAttribute("aria-busy", "true");
	}
	try {
		await run();
	} finally {
		for (const btn of buttons) {
			if (btn.buttonHtml) btn.buttonHtml.disabled = false;
		}
		if (regenBtn.buttonHtml) {
			regenBtn.buttonHtml.removeAttribute("aria-busy");
		}
		refocus(dialog, regenBtn.buttonHtml);
	}
}

export function showBackupCodes(
	answer: unknown,
	opts?: {regenerate?: () => Promise<unknown> | null; view?: boolean},
): void {
	const regenerate = opts?.regenerate;
	const codes = codesOf(answer);
	const raw = (answer as {backup_codes?: unknown} | null | undefined)?.backup_codes;
	if (codes.length === 0) {
		// A codes-verification answer with no usable codes (none minted yet, or all
		// used up) says so instead of doing nothing; a non-array answer stays silent.
		if (!Array.isArray(raw)) return;
		const dialog = new Dialog("");
		dialog.options.addTitle(I18n.backupCodes.title());
		dialog.options.addText(I18n.backupCodes.none());
		const busy: Btn[] = [];
		if (regenerate) {
			dialog.options.addText(I18n.backupCodes.noneRegenerate());
			// One request per action, however often it's tapped. New codes land on a
			// fresh full screen, the same one a view with codes opens.
			let regenerating = false;
			const regenBtn = dialog.options.addButtonInput(
				"",
				I18n.backupCodes.regenerate(),
				async () => {
					if (regenerating) return;
					regenerating = true;
					try {
						await withBusy(dialog, regenBtn, busy, async () => {
							// No codes on screen here, so a throw or an unchanged answer just ends the action.
							let next: unknown;
							try {
								next = await regenerate();
							} catch {
								next = null;
							}
							if (codesOf(next).length > 0) {
								dialog.hide();
								showBackupCodes(next, {...opts, view: false});
							}
						});
					} finally {
						regenerating = false;
					}
				},
			);
			busy.push(regenBtn);
		}
		const doneBtn = dialog.options.addButtonInput("", I18n.backupCodes.done(), () => {
			dialog.hide();
		});
		busy.push(doneBtn);
		dialog.show(false).parentElement!.style.zIndex = "200";
		return;
	}

	let shown = codes;
	const grid = document.createElement("div");
	grid.className = "backupCodeGrid";
	const renderGrid = () => {
		grid.replaceChildren(
			...shown.map((c) => {
				const codeEl = document.createElement("code");
				codeEl.textContent = c;
				return codeEl;
			}),
		);
	};
	renderGrid();

	const dialog = new Dialog("");
	dialog.options.addTitle(I18n.backupCodes.title());
	const explain = dialog.options.addText(
		opts?.view ? I18n.backupCodes.viewExplain() : I18n.backupCodes.explain(),
	);
	dialog.options.addHTMLArea(grid);

	const copyStatus = dialog.options.addText("");
	const busy: Btn[] = [];
	const copyBtn = dialog.options.addButtonInput("", I18n.backupCodes.copy(), async () => {
		try {
			await navigator.clipboard.writeText(shown.join("\n"));
			copyStatus.setText(I18n.backupCodes.copied());
		} catch {
			copyStatus.setText(I18n.backupCodes.copyFailed());
		}
	});
	busy.push(copyBtn);
	const downloadBtn = dialog.options.addButtonInput("", I18n.backupCodes.download(), () => {
		const blob = new Blob([shown.join("\n") + "\n"], {type: "text/plain"});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "machloket-backup-codes.txt";
		a.click();
		// Later, not now: some browsers still read the blob after click() returns.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	busy.push(downloadBtn);
	if (regenerate) {
		// One request and one replacement per action, however often it's tapped.
		let regenerating = false;
		const regenBtn = dialog.options.addButtonInput("", I18n.backupCodes.regenerate(), async () => {
			if (regenerating) return;
			regenerating = true;
			try {
				await withBusy(dialog, regenBtn, busy, async () => {
					// A throw can't say whether the server got as far as expiring: same as null.
					let result: unknown;
					try {
						result = await regenerate();
					} catch {
						result = null;
					}
					// A refusal before anything expired: the codes on screen are still valid.
					if (result === REGEN_UNCHANGED) return;
					const next = codesOf(result);
					// The server expires the old batch before answering; without a usable
					// replacement, the codes on screen can no longer be trusted.
					if (next.length === 0) {
						dialog.hide();
						new Dialog(I18n.backupCodes.regenLost()).show();
					} else {
						shown = next;
						renderGrid();
						explain.setText(I18n.backupCodes.explain());
						// The copied note was about the old batch; it must not read as
						// covering the new one.
						copyStatus.setText("");
					}
				});
			} finally {
				regenerating = false;
			}
		});
		busy.push(regenBtn);
	}
	const doneBtn = dialog.options.addButtonInput("", I18n.backupCodes.done(), () => {
		dialog.hide();
	});
	busy.push(doneBtn);

	dialog.show(false).parentElement!.style.zIndex = "200";
}
