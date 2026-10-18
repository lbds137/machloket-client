import {Dialog} from "../settings.js";
import {I18n} from "../i18n.js";

/** Tells the user a request was refused, or never answered, with the server's reason when it gave one. */
export async function showRefusal(res: Response | undefined) {
	const body = res ? ((await res.json().catch(() => null)) as {message?: unknown} | null) : null;
	const why =
		typeof body?.message === "string" ? body.message : res ? "HTTP " + res.status : "offline";
	new Dialog(I18n.requestFailed(why)).show();
}
