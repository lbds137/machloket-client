import {I18n} from "../i18n.js";

// Kept apart from showRefusal (which needs the settings UI) so standalone pages can use it.

/** The reasons in an invalid form's (50035) `errors`, at any depth, e.g. a bio that's too long. */
export function formErrors(errors: unknown): string[] {
	return errorPaths(errors).flatMap(([, node]) => nodeMessages(node));
}

/** An error node in an invalid form's `errors`. */
type ErrorNode = {_errors: {message?: string; params?: {additionalProperty?: string}}[]};

/** No real form nests this deep, and the instance decides what's in the body. */
const MAX_ERROR_DEPTH = 32;

/** A node's own reasons, skipping anything malformed in its list. */
export function nodeMessages(node: ErrorNode): string[] {
	return node._errors.map((e) => e?.message).filter((m) => typeof m === "string");
}

/** Every `[dotted path, error node]` in an invalid form's `errors`, flat keys and nested objects
 * alike: `{"a.b": node}` and `{a: {b: node}}` both read `a.b`, and the root, `{"": node}` or the
 * object's own `_errors`, reads as the empty path. */
export function errorPaths(errors: unknown): [string, ErrorNode][] {
	const out: [string, ErrorNode][] = [];
	const walk = (node: unknown, path: string, depth: number) => {
		if (!node || typeof node !== "object" || depth > MAX_ERROR_DEPTH) return;
		if (Array.isArray((node as Partial<ErrorNode>)._errors)) out.push([path, node as ErrorNode]);
		for (const [key, value] of Object.entries(node)) {
			if (key !== "_errors") walk(value, path ? path + "." + key : key, depth + 1);
		}
	};
	walk(errors, "", 0);
	return out;
}

/** The field an invalid form's validator says doesn't belong, when it names one. */
export function rejectedProperty(errors: unknown): string | undefined {
	return errorPaths(errors)
		.flatMap(([, node]) => node._errors)
		.map((e) => e?.params?.additionalProperty)
		.filter(Boolean)[0];
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
