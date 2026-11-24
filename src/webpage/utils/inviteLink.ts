import {I18n} from "../i18n.js";
import {apiFetch} from "./apiFetch.js";
import {refusalText, serverReason} from "./refusalText.js";

/** Asks `url` (a channel's /invites) for a new invite and shows its link in `link`, or, when
 * there's none, why: the server's message, the HTTP status, or "offline". */
export async function showNewInvite(
	url: string,
	headers: HeadersInit,
	options: {max_age: number; max_uses: number},
	wellknown: string,
	link: HTMLElement,
) {
	const res = await apiFetch(url, {
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
		link.textContent = await refusalText(undefined);
		return;
	}
	const json = (await res.json().catch(() => null)) as {code?: unknown; message?: unknown} | null;
	// A refusal (no invite permission) has no code: say why, not ".../invite/undefined".
	if (typeof json?.code !== "string") {
		link.textContent = serverReason(json) ?? I18n.requestFailed("HTTP " + res.status);
		return;
	}
	link.textContent = inviteUrl(json.code, wellknown);
}

/** An invite's link: this client's own /invite page, naming the instance it belongs to. */
export function inviteUrl(code: string, wellknown: string): string {
	const params = new URLSearchParams([["instance", wellknown]]);
	return `${location.origin}/invite/${encodeURIComponent(code)}?${params}`;
}

/** Whether `link` holds an invite link (not the reason there's none), so copying it is useful. */
export const holdsInviteLink = (link: HTMLElement) =>
	link.textContent?.startsWith(location.origin + "/invite/") ?? false;
