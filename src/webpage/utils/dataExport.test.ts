import {expect, it} from "vitest";
import {parseExportFilename} from "./dataExport";

const USER_ID = "1553128617381273638";

it("parses the quoted Content-Disposition filename from the live endpoint probe", () => {
	const header = 'attachment; filename="machloket-export-1553128617381273638-20261026.json"';

	expect(parseExportFilename(header, USER_ID)).toBe(
		"machloket-export-1553128617381273638-20261026.json",
	);
});

it("parses an unquoted Content-Disposition filename", () => {
	const header = "attachment; filename=machloket-export-1553128617381273638-20261026.json";

	expect(parseExportFilename(header, USER_ID)).toBe(
		"machloket-export-1553128617381273638-20261026.json",
	);
});

it("falls back to machloket-export-<userId>-<YYYYMMDD>.json when the header is absent or malformed", () => {
	const fixedDate = new Date(2026, 9, 26);

	expect(parseExportFilename(null, USER_ID, fixedDate)).toBe(
		"machloket-export-1553128617381273638-20261026.json",
	);
	expect(parseExportFilename(undefined, USER_ID)).toMatch(
		/^machloket-export-1553128617381273638-\d{8}\.json$/,
	);
	expect(parseExportFilename("attachment", USER_ID, new Date(2026, 0, 5))).toBe(
		"machloket-export-1553128617381273638-20260105.json",
	);
	expect(parseExportFilename('attachment; filename=""', USER_ID, fixedDate)).toBe(
		"machloket-export-1553128617381273638-20261026.json",
	);
});
