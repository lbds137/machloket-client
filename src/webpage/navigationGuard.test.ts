import {expect, it} from "vitest";

// Guard: every full-page navigation goes through pageNav.go (utils/netUtils.ts), which hands
// this session's session-only accounts to the next page first (TASK-6). A raw
// `location.href =` drops them silently. Reloads (`location.reload()`) are not navigations:
// they drop those accounts on purpose, as the "signed in for this session only" copy says.
//
// Like rawFetch.test.ts it matches lines, not code: an aliased `location` or bracket access
// is not caught. Comments are scanned.

// Every non-test source file, as text.
// @ts-expect-error import.meta.glob is Vite's; its vite/client types aren't loaded here
const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./test/**"], {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

// `location.href = x` (not `==`), the parts that navigate when written (`location.pathname = x`,
// search, host, hostname, port, protocol; not hash, which stays on the page), `location.assign(`,
// `location.replace(`, `location = x`.
const NAV =
	/\blocation\s*(?:\.\s*(?:href|pathname|search|host|hostname|port|protocol)\s*=(?!=)|\.\s*assign\s*\(|\.\s*replace\s*\(|=(?!=))/g;

// The one raw navigation: pageNav's own.
const ALLOWED: {file: string; line: string}[] = [
	{file: "./utils/netUtils.ts", line: "window.location.href = href;"},
];

function rawNavigations(sources: Record<string, string>): string[] {
	const found: string[] = [];
	for (const [file, text] of Object.entries(sources)) {
		text.split("\n").forEach((line, i) => {
			for (const _ of line.matchAll(NAV)) {
				const ok = ALLOWED.some((a) => a.file === file && line.trim() === a.line);
				if (!ok) found.push(`${file}:${i + 1}: ${line.trim()}`);
			}
		});
	}
	return found;
}

it("reports each raw navigation shape", () => {
	expect(
		rawNavigations({
			"./a.ts": [
				'window.location.href = "/login";',
				'location.assign("/x");',
				'window.location.replace("/y");',
				'window.location = "/z";',
				'window.location.pathname = "/channels/@me";',
				'location.search = "?a=1";',
				'location.host = "h:1";',
				'location.hostname = "h";',
				'location.port = "1";',
				'location.protocol = "https:";',
			].join("\n"),
		}),
	).toEqual([
		'./a.ts:1: window.location.href = "/login";',
		'./a.ts:2: location.assign("/x");',
		'./a.ts:3: window.location.replace("/y");',
		'./a.ts:4: window.location = "/z";',
		'./a.ts:5: window.location.pathname = "/channels/@me";',
		'./a.ts:6: location.search = "?a=1";',
		'./a.ts:7: location.host = "h:1";',
		'./a.ts:8: location.hostname = "h";',
		'./a.ts:9: location.port = "1";',
		'./a.ts:10: location.protocol = "https:";',
	]);
});

it("does not report reads, comparisons or reloads", () => {
	expect(
		rawNavigations({
			"./a.ts": [
				"const u = new URL(x, window.location.href);",
				"if (location.href === y) {}",
				"window.location.reload();",
				"self.location.href;",
				'location.hash = "#x";',
				"if (location.pathname === p) {}",
			].join("\n"),
		}),
	).toEqual([]);
});

it("every allowlisted navigation still exists", () => {
	for (const a of ALLOWED) {
		expect(
			sources[a.file]?.split("\n").some((l) => l.trim() === a.line),
			`${a.file}: ${a.line}`,
		).toBe(true);
	}
});

it("the real tree navigates only through pageNav", () => {
	expect(rawNavigations(sources)).toEqual([]);
});
