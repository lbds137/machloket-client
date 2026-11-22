import {showRefusal} from "./showRefusal.js";
import {apiFetch} from "./apiFetch.js";

/** `file` as a data: URL, the form profile saves send images in. */
export function readDataURL(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** PATCHes `body` to `url` and, when it isn't saved, says why. Resolves to whether it was. */
export async function saveProfile(url: string, headers: HeadersInit, body: object) {
	const res = await apiFetch(url, {
		method: "PATCH",
		headers,
		body: JSON.stringify(body),
		timeoutMs: 0, // data: URL image bodies are large uploads; the 30 s budget would cut them.
	}).catch(() => undefined);
	if (res?.ok) return true;
	await showRefusal(res);
	return false;
}
