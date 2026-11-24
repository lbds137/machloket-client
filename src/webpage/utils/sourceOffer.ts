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
	const {protocol, search, hash} = new URL(base);
	if (protocol !== "https:" && protocol !== "http:") {
		throw new Error(`MACHLOKET_SOURCE_URL must be an http(s) address, got: ${base}`);
	}
	// "/tree/<revision>" is appended to it, so it ends at its path.
	if (search || hash || /[?#]/.test(base)) {
		throw new Error(`MACHLOKET_SOURCE_URL must be a repository address, no ? or #: ${base}`);
	}
	const rev = revision.trim();
	// "." and ".." name no revision: as a path segment they would climb out of /tree/.
	if (!rev || rev === "dev" || rev === "." || rev === "..") return base;
	const segment = encodeURIComponent(rev).replace(
		/[()]/g,
		(c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
	);
	return `${base}/tree/${segment}`;
}

/** The credit line, with the source link as a plain anchor: the app's Markdown gives a link to
 * an untrusted host no href, and this offer must always open. `line` is the translated text,
 * given what to put where the link goes. The first placeholder becomes the link and any later
 * one the address as text; a translation that drops it still gets the link, after its text. */
export function creditLine(line: (link: string) => string, url: string): HTMLParagraphElement {
	const marker = String.fromCharCode(1);
	const [before, ...rest] = line(marker).split(marker);
	const a = document.createElement("a");
	a.href = url;
	a.textContent = url;
	a.target = "_blank";
	a.rel = "noreferrer";
	const p = document.createElement("p");
	p.className = "sourceOffer";
	if (rest.length === 0) p.append(before, " ", a);
	else p.append(before, a, rest.join(url));
	return p;
}
