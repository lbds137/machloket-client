import {I18n} from "../i18n.js";

// Kept apart from showRefusal (which needs the settings UI) so standalone pages can use it.

/** The reasons in an invalid form's (50035) `errors`: the nested `..._errors[].message`, e.g. a
 * bio that's too long. */
export function formErrors(errors: unknown): string[] {
	const found: string[] = [];
	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;
		for (const [key, value] of Object.entries(node)) {
			if (key === "_errors" && Array.isArray(value)) {
				for (const e of value) if (typeof e?.message === "string") found.push(e.message);
			} else {
				walk(value);
			}
		}
	};
	walk(errors);
	return found;
}

/** The server's own reason in a JSON error body: the 50035 field errors joined by a space, else a
 * string `message`, else null. */
export function serverReason(body: unknown): string | null {
	const json = body as {code?: unknown; message?: unknown; errors?: unknown} | null;
	const fields = json?.code === 50035 ? formErrors(json.errors) : [];
	if (fields.length) return fields.join(" ");
	return typeof json?.message === "string" ? json.message : null;
}

/** The line saying a request was refused, or never answered, with the server's reason when it
 * gave one: what an invalid form got wrong, else its message. */
export async function refusalText(res: Response | undefined) {
	const body = res ? await res.json().catch(() => null) : null;
	const why = serverReason(body) ?? (res ? "HTTP " + res.status : "offline");
	return I18n.requestFailed(why);
}
