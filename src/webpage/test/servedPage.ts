/**
 * Mounts a page's HTML as served (a `?raw` import of the .html file) as the document body, its
 * scripts left out: the elements the page code finds, as the page ships them. Landing-page tests
 * mount this instead of a hand-written copy, which drifts from the real page.
 */
export function mountServedPage(html: string): void {
	const page = new DOMParser().parseFromString(html, "text/html");
	page.querySelectorAll("script").forEach((s) => s.remove());
	document.body.innerHTML = page.body.innerHTML;
}
