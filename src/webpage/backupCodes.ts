import {Dialog} from "./settings";
import {I18n} from "./i18n";

type BackupCodeEntry = {code?: unknown; consumed?: unknown};

/** The unconsumed, non-empty code strings in a codes-verification answer. */
function codesOf(answer: unknown): string[] {
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

export function showBackupCodes(
	answer: unknown,
	opts?: {regenerate?: () => Promise<unknown> | null},
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
		if (regenerate) {
			// One request per action, however often it's tapped. New codes land on a
			// fresh full screen, the same one a view with codes opens.
			let regenerating = false;
			dialog.options.addButtonInput("", I18n.backupCodes.regenerate(), async () => {
				if (regenerating) return;
				regenerating = true;
				try {
					const next = await regenerate();
					if (codesOf(next).length > 0) {
						dialog.hide();
						showBackupCodes(next, opts);
					}
				} finally {
					regenerating = false;
				}
			});
		}
		dialog.options.addButtonInput("", I18n.backupCodes.done(), () => {
			dialog.hide();
		});
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
	dialog.options.addText(I18n.backupCodes.explain());
	dialog.options.addHTMLArea(grid);

	const copyStatus = dialog.options.addText("");
	dialog.options.addButtonInput("", I18n.backupCodes.copy(), async () => {
		try {
			await navigator.clipboard.writeText(shown.join("\n"));
			copyStatus.setText(I18n.backupCodes.copied());
		} catch {
			copyStatus.setText(I18n.backupCodes.copyFailed());
		}
	});
	dialog.options.addButtonInput("", I18n.backupCodes.download(), () => {
		const blob = new Blob([shown.join("\n") + "\n"], {type: "text/plain"});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "machloket-backup-codes.txt";
		a.click();
		// Later, not now: some browsers still read the blob after click() returns.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	if (regenerate) {
		// One request and one replacement per action, however often it's tapped.
		let regenerating = false;
		dialog.options.addButtonInput("", I18n.backupCodes.regenerate(), async () => {
			if (regenerating) return;
			regenerating = true;
			try {
				const next = codesOf(await regenerate());
				// A regenerate that answers nothing leaves the last shown batch up:
				// blanking the grid would read as the codes being gone.
				if (next.length > 0) {
					shown = next;
					renderGrid();
					// The copied note was about the old batch; it must not read as
					// covering the new one.
					copyStatus.setText("");
				}
			} finally {
				regenerating = false;
			}
		});
	}
	dialog.options.addButtonInput("", I18n.backupCodes.done(), () => {
		dialog.hide();
	});

	dialog.show(false).parentElement!.style.zIndex = "200";
}
