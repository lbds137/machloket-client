import {fetchRetryOnce} from "./rateLimit.js";

/** Joins the guild behind `code`; `ok` says whether the flow may navigate, and an existing
 * member counts. `alreadyMember` marks that case, for a caller that opens the guild instead of
 * a fresh join. The server's already-member refusal is a generic HTTPError (400) with no code,
 * so its message is the only key; `guildId` is the guild a fresh join landed in (absent for
 * the already-member refusal, whose 400 body carries no id). Kept free of page side effects
 * (invite.ts runs its page on import), so the embed and the join dialog can share it. */
export async function acceptInvite(
	api: string,
	code: string,
	token: string,
): Promise<{ok: boolean; message?: string; alreadyMember?: boolean; guildId?: string}> {
	const res = await fetchRetryOnce(`${api}/invites/${code}`, {
		method: "POST",
		headers: {
			Authorization: token,
		},
	});
	if (res.ok) {
		// Discord's invite object names the guild in `guild`; the older answer had `guild_id`.
		const json = (await res.json().catch(() => undefined)) as
			| {guild_id?: string; guild?: {id?: string}}
			| undefined;
		return {ok: true, guildId: json?.guild?.id ?? json?.guild_id};
	}
	const json = (await res.json().catch(() => undefined)) as {message?: string} | undefined;
	if (/already a member/i.test(json?.message ?? "")) return {ok: true, alreadyMember: true};
	return {ok: false, message: json?.message ?? `${res.status}`};
}
