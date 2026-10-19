import {expect, it} from "vitest";

// Every non-test source file, as text.
// @ts-expect-error import.meta.glob is Vite's; its vite/client types aren't loaded here
const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./test/**"], {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const Q = "[\"'`]";
/** Places where a string literal reaches the screen as is. Text shown to users goes through
 * I18n (translations/en.json), so a literal starting with a letter in one of these is English
 * that never gets translated. Links (http…) are not prose. Matched one line at a time, so a
 * label on its own line (a multi-line call, an option array passed to addSelect) or one
 * starting lowercase is not seen. */
const SINKS = [
	new RegExp(
		`\\.(textContent|innerText|title|placeholder|ariaLabel|alt)\\s*=\\s*${Q}(?!https?:)[A-Za-z]`,
	),
	new RegExp(
		`\\.setAttribute\\(\\s*${Q}(title|aria-label|placeholder|alt)${Q}\\s*,\\s*${Q}[A-Za-z]`,
	),
	new RegExp(`\\b(alert|confirm|prompt)\\(\\s*${Q}[A-Za-z]`),
	new RegExp(`\\b(alert|confirm|prompt)\\([^;]*\\?\\s*${Q}[A-Za-z]`),
	new RegExp(`\\.(pageTitle|add[A-Z]\\w*)\\(\\s*${Q}[A-Z]`),
	new RegExp(`\\.add[A-Z]\\w*\\(\\s*${Q}${Q}\\s*,\\s*${Q}[A-Z]`),
	new RegExp(`\\bnew (Dialog|Float)\\(\\s*${Q}[A-Z]`),
];

it("puts no English literal straight into a known on-screen sink", () => {
	expect(Object.keys(sources).length).toBeGreaterThan(50);
	const offenders: string[] = [];
	for (const [path, text] of Object.entries(sources)) {
		text.split("\n").forEach((line, i) => {
			const code = line.replace(/^\s*(\/\/|\/?\*).*$/, "");
			if (SINKS.some((sink) => sink.test(code))) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
		});
	}
	expect(offenders).toEqual([]);
});
