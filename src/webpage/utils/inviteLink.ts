import {I18n} from "../i18n.js";

/** Asks `url` (a channel's /invites) for a new invite and shows its link in `link`, or, when
 * there's none, why: the server's message, the HTTP status, or "offline". */
export async function showNewInvite(
	url: string,
	headers: HeadersInit,
	options: {max_age: number; max_uses: number},
	wellknown: string,
	link: HTMLElement,
) {
	const res = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			flags: 0,
			target_type: null,
			target_user_id: null,
			max_age: options.max_age + "",
			max_uses: options.max_uses,
			// Discord's temporary membership (kicked on going offline) isn't a use limit.
			temporary: false,
		}),
	}).catch(() => undefined);
	if (!res) {
		link.textContent = I18n.requestFailed("offline");
		return;
	}
	const json = (await res.json().catch(() => null)) as {code?: unknown; message?: unknown} | null;
	// A refusal (no invite permission) has no code: say why, not ".../i/undefined".
	if (typeof json?.code !== "string") {
		link.textContent =
			typeof json?.message === "string" ? json.message : I18n.requestFailed("HTTP " + res.status);
		return;
	}
	const params = new URLSearchParams([["instance", wellknown]]);
	link.textContent = `https://sbar.fyi/i/${json.code}?${params}`;
}

/** Whether `link` holds an invite link (not the reason there's none), so copying it is useful. */
export const holdsInviteLink = (link: HTMLElement) =>
	link.textContent?.startsWith("https://sbar.fyi/i/") ?? false;
