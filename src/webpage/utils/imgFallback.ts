// No imports on purpose: modules on both sides of the app's import cycles use this; importing utils.ts from them shifts evaluation order (TASK-78).

/**
 * When `img` fails to load (the CDN deleted the file, or the network failed), run `fallback` once.
 * A fallback that returns an element replaces `img` in place; one that returns nothing has handled
 * it itself (swapped the src, removed the img). Only the first error counts, so a fallback src that
 * also fails can't loop.
 */
export function onImgBroken(img: HTMLImageElement, fallback: () => HTMLElement | void): void {
	img.addEventListener(
		"error",
		() => {
			const replacement = fallback();
			if (replacement && img.parentNode) img.replaceWith(replacement);
		},
		{once: true},
	);
}
