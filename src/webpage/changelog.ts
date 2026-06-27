import {I18n} from "./i18n.js";
import {MarkDown} from "./markdown.js";
import {Dialog} from "./settings.js";

const CHANGELOG_STORAGE_KEY = "fermoChangelogVersion";
const CHANGELOG_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Increment this when updating CHANGELOG_CONTENT to show the popup again. */
export const CHANGELOG_VERSION = 1;

/**
 * Yo dev. here a smalli guidy
 * Markdown changelog content. Images are supported via ![alt](src):
 * - Remote: ![Screenshot](https://example.com/image.png)
 * - Public: ![Logo](/logo.svg)
 * - Bundled: ![Preview](./changelog/preview.png) -> place files in src/webpage/public/changelog/
 */
export const CHANGELOG_CONTENT = `# Fermooo update!

## Free message translation!!!!!
![translate](./changelog/1-translate.webp)

## Some animations and more visual improvements soon
![visual](./changelog/1-visual.webp)

## New notification sounds!!
![sounds](./changelog/1-sounds.webp)

## Polls! (be careful using them)
![polls](./changelog/1-poll.webp)
`;

function resolveChangelogImageSrc(src: string): string {
	const trimmed = src.trim();
	if (/^(https?:\/\/|data:|\/)/.test(trimmed)) {
		return trimmed;
	}
	return new URL(trimmed, import.meta.url).href;
}

function renderMarkdownFragment(text: string): HTMLElement {
	const markdown = new MarkDown(text, undefined);
	return markdown.makeHTML();
}

function renderChangelogContent(content: string): HTMLElement {
	const container = document.createElement("div");
	container.classList.add("changelogContent");

	let lastIndex = 0;
	for (const match of content.matchAll(CHANGELOG_IMAGE_PATTERN)) {
		const index = match.index ?? 0;
		const textBefore = content.slice(lastIndex, index);
		if (textBefore.trim()) {
			container.append(renderMarkdownFragment(textBefore));
		}

		const img = document.createElement("img");
		img.src = resolveChangelogImageSrc(match[2]);
		img.alt = match[1];
		img.classList.add("changelogImage");
		img.loading = "lazy";
		container.append(img);

		lastIndex = index + match[0].length;
	}

	const remaining = content.slice(lastIndex);
	if (remaining.trim()) {
		container.append(renderMarkdownFragment(remaining));
	}

	return container;
}

function getStoredChangelogVersion(): string | null {
	return localStorage.getItem(CHANGELOG_STORAGE_KEY);
}

export function shouldShowChangelog(): boolean {
	const stored = getStoredChangelogVersion();
	if (stored === "0") return false;
	return stored !== String(CHANGELOG_VERSION);
}

export function showChangelogPopup({force = false} = {}): void {
	if (!force && !shouldShowChangelog()) return;

	const dialog = new Dialog(I18n.changelog.title(), {noSubmit: true});
	const container = document.createElement("div");
	container.classList.add("changelogBody");
	container.append(renderChangelogContent(CHANGELOG_CONTENT));

	dialog.options.addHTMLArea(container);

	dialog.options.addButtonInput("", I18n.changelog.ok(), () => {
		localStorage.setItem(CHANGELOG_STORAGE_KEY, String(CHANGELOG_VERSION));
		dialog.hide();
	});

	const center = dialog.show(false);
	center.classList.add("changelogDialog");
	const background = center.parentElement;
	if (background) {
		background.classList.remove("solidBackground");
		background.classList.add("changelogBackdrop");
	}
}