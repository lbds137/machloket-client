import {Dialog} from "./settings";
import {I18n} from "./i18n";

export function showBackupCodes(answer: unknown): void {
	const raw = (answer as {backup_codes?: unknown} | null | undefined)?.backup_codes;
	if (!Array.isArray(raw)) return;
	const codes: string[] = [];
	for (const entry of raw) {
		if (
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as {code?: unknown}).code === "string" &&
			(entry as {code: string}).code.length > 0 &&
			(entry as {consumed?: unknown}).consumed !== true
		) {
			codes.push((entry as {code: string}).code);
		}
	}
	if (codes.length === 0) return;

	const dialog = new Dialog("");
	dialog.options.addTitle(I18n.backupCodes.title());
	dialog.options.addText(I18n.backupCodes.explain());

	const grid = document.createElement("div");
	grid.className = "backupCodeGrid";
	for (const c of codes) {
		const codeEl = document.createElement("code");
		codeEl.textContent = c;
		grid.append(codeEl);
	}
	dialog.options.addHTMLArea(grid);

	const copyStatus = dialog.options.addText("");
	dialog.options.addButtonInput("", I18n.backupCodes.copy(), async () => {
		try {
			await navigator.clipboard.writeText(codes.join("\n"));
			copyStatus.setText(I18n.backupCodes.copied());
		} catch {
			copyStatus.setText(I18n.backupCodes.copyFailed());
		}
	});
	dialog.options.addButtonInput("", I18n.backupCodes.download(), () => {
		const blob = new Blob([codes.join("\n") + "\n"], {type: "text/plain"});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "machloket-backup-codes.txt";
		a.click();
		// Later, not now: some browsers still read the blob after click() returns.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	dialog.options.addButtonInput("", I18n.backupCodes.done(), () => {
		dialog.hide();
	});

	dialog.show(false).parentElement!.style.zIndex = "200";
}
