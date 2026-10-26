import {I18n} from "../i18n.js";
import {refusalText} from "./refusalText.js";

export function fallbackExportFilename(userId: string, now: Date = new Date()): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `machloket-export-${userId}-${year}${month}${day}.json`;
}

export function parseExportFilename(
	contentDisposition: string | null | undefined,
	userId: string,
	now: Date = new Date(),
): string {
	if (contentDisposition) {
		const match = /(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;\s"]+))\s*(?:;|$)/i.exec(
			contentDisposition,
		);
		const raw = (match?.[1] ?? match?.[2])?.trim();
		if (raw) return raw;
	}
	return fallbackExportFilename(userId, now);
}

export async function exportUserData(
	api: string,
	headers: HeadersInit,
	userId: string,
): Promise<string | null> {
	const url = api.replace(/\/+$/, "") + "/users/@me/export";
	const res = await fetch(url, {headers}).catch(() => undefined);
	if (!res?.ok) {
		return I18n.localuser.exportFailed(await refusalText(res));
	}
	const blob = await res.blob().catch(() => null);
	if (!blob) {
		return I18n.localuser.exportFailed(await refusalText(undefined));
	}
	const filename = parseExportFilename(res.headers.get("content-disposition"), userId);
	const blobUrl = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = blobUrl;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
	return null;
}
