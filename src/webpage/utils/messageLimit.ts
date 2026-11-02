import {I18n} from "../i18n.js";

/** The instance's limit on a message's length. Unknown (an instance without the route, offline, an
 * odd answer) is undefined: nothing is checked here and the server's refusal says why, which beats
 * holding on to an old limit that may refuse what the server would now take. */
export async function fetchMessageLimit(api: string): Promise<number | undefined> {
	const res = await fetch(api + "/policies/instance/config").catch(() => undefined);
	if (!res?.ok) return undefined;
	const json = (await res.json().catch(() => null)) as {
		limits_message_maxCharacters?: unknown;
	} | null;
	const limit = json?.limits_message_maxCharacters;
	return Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : undefined;
}

/** Why `content` is over the limit, or null when it fits or the limit is unknown. Counts as the
 * server does: `length`, so UTF-16 units (an emoji is 2) and whitespace it would trim. */
export function tooLongReason(content: string, limit: number | undefined): string | null {
	if (limit === undefined || content.length <= limit) return null;
	return I18n.channel.tooLong(String(content.length), String(limit));
}
