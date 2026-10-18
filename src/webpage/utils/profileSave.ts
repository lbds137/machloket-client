import {showRefusal} from "./showRefusal.js";

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
	const res = await fetch(url, {method: "PATCH", headers, body: JSON.stringify(body)}).catch(
		() => undefined,
	);
	if (res?.ok) return true;
	await showRefusal(res);
	return false;
}
