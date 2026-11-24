/** Where this client's source is published. AGPL-3.0 section 13 has the running app offer its
 * users the source of the version they use: Client information links it (TASK-19). */
export const DEFAULT_SOURCE_REPO = "https://github.com/lbds137/machloket-client";

/**
 * The "source for this build" link: the repository at the revision the build was made from.
 * `repo` is the MACHLOKET_SOURCE_URL build setting, for a deployment that publishes its own
 * changes; unset means this repository. A build with no known revision ("dev", vite.config.js's
 * getBuildVersion outside a git checkout) links the repository itself. Read at build time
 * (vite.config.js), so a bad setting fails the build instead of shipping a broken offer.
 */
export function sourceUrl(repo: string | undefined, revision: string): string {
	const base = (repo?.trim() || DEFAULT_SOURCE_REPO).replace(/\/+$/, "");
	// A link people also copy out of the text: no whitespace, brackets or parentheses that would
	// end it early when it is pasted or auto-linked elsewhere.
	if (/[\s()[\]<>]/.test(base) || !URL.canParse(base)) {
		throw new Error(`MACHLOKET_SOURCE_URL must be a web address, got: ${base}`);
	}
	const {protocol} = new URL(base);
	if (protocol !== "https:" && protocol !== "http:") {
		throw new Error(`MACHLOKET_SOURCE_URL must be an http(s) address, got: ${base}`);
	}
	const rev = revision.trim();
	if (!rev || rev === "dev") return base;
	return `${base}/tree/${encodeURIComponent(rev)}`;
}

/** The credit line, with the source link as a plain anchor: the app's Markdown gives a link to
 * an untrusted host no href, and this offer must always open. `line` is the translated text,
 * given what to put where the link goes. */
export function creditLine(line: (link: string) => string, url: string): HTMLParagraphElement {
	const marker = String.fromCharCode(1);
	const [before, after = ""] = line(marker).split(marker);
	const a = document.createElement("a");
	a.href = url;
	a.textContent = url;
	a.target = "_blank";
	a.rel = "noreferrer";
	const p = document.createElement("p");
	p.className = "sourceOffer";
	p.append(before, a, after);
	return p;
}
