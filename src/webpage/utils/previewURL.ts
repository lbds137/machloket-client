/**
 * One object URL at a time for a picked file's preview: each new pick (or a clear, with null)
 * revokes the previous URL, which the browser would otherwise keep alive for the page's life.
 */
export function previewURL() {
	let url: string | undefined;
	function next(blob: Blob): string;
	function next(blob: null): undefined;
	function next(blob: Blob | null) {
		if (url) URL.revokeObjectURL(url);
		url = blob ? URL.createObjectURL(blob) : undefined;
		return url;
	}
	return next;
}
