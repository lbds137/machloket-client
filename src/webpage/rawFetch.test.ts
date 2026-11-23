import {expect, it} from "vitest";

// Guard: no raw `fetch(` in src outside the ALLOWED leaves (TASK-77, U-api 2e).
// Every API call goes through apiFetch, which refuses redirects and carries the
// credentials. The leaves are the calls that cannot use it (worker scope, same-origin
// static assets, module-scope code inside the utils <-> apiFetch cycle, dead code).
//
// What it sees: every match of CALL or WINDOW, one line at a time. It does not parse code,
// so a `fetch` passed as a value (`.then(fetch)`), aliased, or reached by bracket access
// (`globalThis["fetch"]`) is NOT caught. Comments ARE scanned, which is why the
// block-comment leaves are listed. Each match must be covered by exactly one entry whose
// snippet spans it, so a second call beside an allowed one on the same line still fails.
// A new leaf means an ALLOWED entry with a reason; a leaf that goes away means its entry
// must go too (a stale count fails).

// Every non-test source file, as text.
// @ts-expect-error import.meta.glob is Vite's; its vite/client types aren't loaded here
const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./test/**"], {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

// A call: `fetch(` not preceded by an identifier char or `.` (so apiFetch(, prefetch(,
// x.fetch( are not calls), optionally `fetch?.(`. No `\s*` before the paren: prose like
// "fetch (" is not a call, and prettier writes every call as `fetch(`.
const CALL = /(?<![A-Za-z0-9_$.])fetch(?:\?\.)?\(/g;
// A reference to the global fetch, e.g. the credentials shim that replaces window.fetch.
const WINDOW = /\b(?:window|globalThis|self)\s*\.\s*fetch\b/g;

type Allowed = {file: string; snippet: string; count: number; reason: string};

// One entry per distinct call shape. `snippet` is a substring of the hit line that spans the
// whole match (it includes the `fetch(` itself); `count` is how many matches in that file it
// covers.
const ALLOWED: Allowed[] = [
	// Worker scope: no apiFetch, no window.
	{
		file: "./service.ts",
		snippet: 'fetch(new URL("/files.json"',
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: "fetch(lpath)",
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: 'fetch("/getupdates"',
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: "fetch(req.clone())",
		count: 2,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: "fetch(new Request(req",
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: "fetch(req.url)",
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	{
		file: "./service.ts",
		snippet: "fetch(req);",
		count: 1,
		reason: "worker scope: no apiFetch or window",
	},
	// Same-origin build-version probe.
	{
		file: "./channel.ts",
		snippet: 'fetch("/getupdates"',
		count: 1,
		reason: "same-origin build-version probe",
	},
	{
		file: "./localuser.ts",
		snippet: 'fetch("/getupdates"',
		count: 1,
		reason: "same-origin build-version probe",
	},
	{
		file: "./utils/assetCache.ts",
		snippet: 'fetch("/getupdates"',
		count: 1,
		reason: "same-origin build-version probe",
	},
	// Same-origin static assets.
	{
		file: "./i18n.ts",
		snippet: "fetch(new URL(`./translations/",
		count: 1,
		reason: "same-origin static asset (translations)",
	},
	{
		file: "./utils/cssMagic.ts",
		snippet: 'fetch("/style.css")',
		count: 1,
		reason: "same-origin static asset (style.css)",
	},
	{
		file: "./user.ts",
		snippet: 'fetch("/custom-badges.json"',
		count: 1,
		reason: "same-origin static asset (custom-badges.json)",
	},
	{
		file: "./emoji.ts",
		snippet: "fetch(emojiUrl.href)",
		count: 1,
		reason: "same-origin static asset (emoji.bin)",
	},
	{
		file: "./utils/notificationSound.ts",
		snippet: "fetch(path)",
		count: 1,
		reason: "same-origin static asset (sounds)",
	},
	{
		file: "./utils/storage/notificationSoundStorage.ts",
		snippet: "fetch(sound.path)",
		count: 1,
		reason: "same-origin static asset (sounds)",
	},
	{
		file: "./audio/play.ts",
		snippet: "fetch(url)",
		count: 1,
		reason: "same-origin static asset (asset playURL)",
	},
	{
		file: "./audio/worklet/play.ts",
		snippet: "fetch(url)",
		count: 1,
		reason: "same-origin static asset (asset playURL)",
	},
	// utils.ts runs at module scope; the utils <-> apiFetch import cycle forbids apiFetch there.
	{
		file: "./utils/utils.ts",
		snippet: 'fetch(new URL("/instances.json"',
		count: 1,
		reason: "module scope: utils <-> apiFetch cycle forbids apiFetch",
	},
	{
		file: "./utils/utils.ts",
		snippet: "fetch(catalogBotsUrl)",
		count: 1,
		reason: "third-party bot catalog, token-less",
	},
	{
		file: "./utils/utils.ts",
		snippet: "fetch(url, {signal: controller.signal}",
		count: 1,
		reason: "discoveryJson follows redirects on purpose (2e task 3)",
	},
	// The credentials shim that wraps window.fetch.
	{
		file: "./utils/utils.ts",
		snippet: "window.fetch;",
		count: 1,
		reason: "credentials shim wraps window.fetch",
	},
	{
		file: "./utils/utils.ts",
		snippet: "window.fetch = function",
		count: 1,
		reason: "credentials shim wraps window.fetch",
	},
	// Default `fetcher` parameters; their callers pass CDN URLs.
	{
		file: "./utils/progessiveLoad.ts",
		snippet: "=> fetch(input, init)",
		count: 2,
		reason: "default fetcher parameter; callers pass CDN URLs",
	},
	// Dead code: inside a block comment, or under `const serverbug = false`.
	{
		file: "./guild.ts",
		snippet: 'fetch(guild.info.api + "/guilds/" + guild.id + "/bans/"',
		count: 1,
		reason: "dead: inside a block comment",
	},
	{
		file: "./guild.ts",
		snippet: 'fetch(this.info.api + "/guilds/" + this.id + "/channels"',
		count: 1,
		reason: "dead: under const serverbug = false",
	},
	{
		file: "./channel.ts",
		snippet: 'fetch(this.info.api + "/channels/" + this.id + "/messages"',
		count: 2,
		reason: "dead: inside a block comment",
	},
	// apiFetch's own internals.
	{
		file: "./utils/apiFetch.ts",
		snippet: "fetch(parsed.origin",
		count: 1,
		reason: "apiFetch's own internals",
	},
	{
		file: "./utils/apiFetch.ts",
		snippet: 'fetch(input, {...restInit, redirect: "error", signal: initSignal',
		count: 1,
		reason: "apiFetch's own internals",
	},
	{
		file: "./utils/apiFetch.ts",
		snippet: 'fetch(input, {...restInit, redirect: "error", signal});',
		count: 1,
		reason: "apiFetch's own internals",
	},
];

/** One match of CALL or WINDOW: its file, line (1-based `n`) and column span. */
type Hit = {file: string; line: string; n: number; start: number; end: number};

/** An entry covers a hit when one of the snippet's places on that line spans the whole match,
 * so a snippet can't vouch for a second call beside it on the same line. */
function covers(e: Allowed, h: Hit): boolean {
	// An empty snippet would never advance (indexOf clamps at the line's end); check() reports it.
	if (e.file !== h.file || e.snippet === "") return false;
	for (
		let p = h.line.indexOf(e.snippet);
		p !== -1 && p <= h.start;
		p = h.line.indexOf(e.snippet, p + 1)
	) {
		if (h.end <= p + e.snippet.length) return true;
	}
	return false;
}

// Returns failure messages: hits no entry covers (or more than one does), and entries whose
// count of covered hits is off.
function check(sources: Record<string, string>, allowed: Allowed[]): string[] {
	const failures: string[] = [];
	const hits: Hit[] = [];
	for (const [file, text] of Object.entries(sources)) {
		text.split("\n").forEach((line, i) => {
			for (const re of [CALL, WINDOW]) {
				for (const m of line.matchAll(re)) {
					hits.push({file, line, n: i + 1, start: m.index, end: m.index + m[0].length});
				}
			}
		});
	}
	const where = (h: Hit) => `${h.file}:${h.n}:${h.start + 1}: ${h.line.trim()}`;
	for (const hit of hits) {
		const by = allowed.filter((e) => covers(e, hit)).length;
		if (by === 0) failures.push(`raw fetch outside the allowlist: ${where(hit)}`);
		if (by > 1) failures.push(`raw fetch covered by ${by} allowlist entries: ${where(hit)}`);
	}
	for (const e of allowed) {
		if (
			e.snippet === "" ||
			e.reason.trim() === "" ||
			!(Number.isInteger(e.count) && e.count >= 1)
		) {
			failures.push(
				`allowlist entry ${e.file} ${JSON.stringify(e.snippet)} is malformed (empty snippet, blank reason or count below 1)`,
			);
			continue;
		}
		const matches = hits.filter((h) => covers(e, h)).length;
		if (matches !== e.count) {
			failures.push(
				`allowlist entry ${e.file} ${JSON.stringify(e.snippet)} covers ${matches} matches, expected ${e.count}`,
			);
		}
	}
	return failures;
}

it("reports a raw fetch call outside the allowlist", () => {
	expect(check({"./a.ts": "x = fetch(u);"}, [])).toEqual([
		"raw fetch outside the allowlist: ./a.ts:1:5: x = fetch(u);",
	]);
});

it("reports a count mismatch when an entry matches more lines than it claims", () => {
	const allowed = [{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: "test"}];
	expect(check({"./a.ts": "x = fetch(u);\ny = fetch(u);"}, allowed)).toEqual([
		'allowlist entry ./a.ts "fetch(u)" covers 2 matches, expected 1',
	]);
});

it("reports a stale entry that matches no lines", () => {
	const allowed = [{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: "test"}];
	expect(check({"./a.ts": "y = 1;"}, allowed)).toEqual([
		'allowlist entry ./a.ts "fetch(u)" covers 0 matches, expected 1',
	]);
});

it("does not report apiFetch, a method call, prefetch or originalFetch", () => {
	expect(
		check({"./a.ts": "apiFetch(u);\nx.fetch(u);\nprefetch(u);\noriginalFetch(u);"}, []),
	).toEqual([]);
});

it("reports an assignment to window.fetch", () => {
	expect(check({"./a.ts": "window.fetch = f;"}, [])).toEqual([
		"raw fetch outside the allowlist: ./a.ts:1:1: window.fetch = f;",
	]);
});

it("reports a second raw call on a line whose first call is allowed", () => {
	const allowed = [{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: "test"}];
	expect(check({"./a.ts": "fetch(u); fetch(v);"}, allowed)).toEqual([
		"raw fetch outside the allowlist: ./a.ts:1:11: fetch(u); fetch(v);",
	]);
});

it("does not let a snippet away from the call cover it", () => {
	const allowed = [{file: "./a.ts", snippet: '"/bans/"', count: 1, reason: "test"}];
	expect(check({"./a.ts": 'apiFetch(u + "/bans/") || fetch(v);'}, allowed)).toEqual([
		'raw fetch outside the allowlist: ./a.ts:1:27: apiFetch(u + "/bans/") || fetch(v);',
		'allowlist entry ./a.ts "\\"/bans/\\"" covers 0 matches, expected 1',
	]);
});

it("counts each call, not each line", () => {
	const allowed = [{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: "test"}];
	expect(check({"./a.ts": "fetch(u) || fetch(u);"}, allowed)).toEqual([
		'allowlist entry ./a.ts "fetch(u)" covers 2 matches, expected 1',
	]);
});

it("reports a call two entries both cover", () => {
	const allowed = [
		{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: "test"},
		{file: "./a.ts", snippet: "= fetch(u)", count: 1, reason: "test"},
	];
	expect(check({"./a.ts": "x = fetch(u);"}, allowed)).toEqual([
		"raw fetch covered by 2 allowlist entries: ./a.ts:1:5: x = fetch(u);",
	]);
});

it("reports a malformed entry", () => {
	const allowed = [
		{file: "./a.ts", snippet: "", count: 1, reason: "test"},
		{file: "./a.ts", snippet: "fetch(u)", count: 1, reason: " "},
		{file: "./a.ts", snippet: "fetch(v)", count: 0, reason: "test"},
	];
	expect(check({"./a.ts": "fetch(u);"}, allowed)).toEqual([
		'allowlist entry ./a.ts "" is malformed (empty snippet, blank reason or count below 1)',
		'allowlist entry ./a.ts "fetch(u)" is malformed (empty snippet, blank reason or count below 1)',
		'allowlist entry ./a.ts "fetch(v)" is malformed (empty snippet, blank reason or count below 1)',
	]);
});

it("reports an optional call", () => {
	expect(check({"./a.ts": "fetch?.(u);"}, [])).toEqual([
		"raw fetch outside the allowlist: ./a.ts:1:1: fetch?.(u);",
	]);
});

it("the real tree has no raw fetch outside the allowlist", () => {
	expect(check(sources, ALLOWED)).toEqual([]);
});
