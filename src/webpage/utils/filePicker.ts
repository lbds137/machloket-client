/**
 * Opens the browser's file picker; `onFiles` gets what was picked (never an empty pick).
 * Everything is set before the click, so the picker opens fully configured.
 */
export function pickFiles(onFiles: (files: File[]) => void, {multiple = true} = {}) {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = multiple;
	input.onchange = () => {
		const files = Array.from(input.files ?? []);
		if (files.length) onFiles(files);
	};
	input.click();
}
