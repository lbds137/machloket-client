import {refusalText} from "../utils/refusalText.js";

export type botjsonfetch = {
	guilds: {
		id: string;
		name: string;
		icon: string;
		mfa_level: number;
		permissions: string;
	}[];
	user: {
		id: string;
		username: string;
		avatar: string;
		avatar_decoration?: string;
		discriminator: string;
		public_flags: number;
	};
	application: {
		id: string;
		name: string;
		icon: string | null;
		description: string;
		summary: string;
		type: null; //not sure what this means :P
		hook: boolean;
		guild_id: null | string;
		bot_public: boolean;
		bot_require_code_grant: boolean;
		verify_key: "IMPLEMENTME"; //no clue what this is meant to be :P
		flags: number;
	};
	bot: {
		id: string;
		username: string;
		avatar: string | null;
		avatar_decoration: null | string;
		discriminator: string;
		public_flags: number;
		bot: boolean;
		approximated_guild_count: number;
	};
	authorized: boolean;
};

/** The bot invite page's details (the bot, its app, the user's servers) for `search` (the
 * page's query: client_id, permissions…), or the line saying why there are none. */
export async function fetchBotInvite(
	api: string,
	token: string,
	search: string,
): Promise<botjsonfetch | string> {
	const res = await fetch(api + "/oauth2/authorize/" + search, {
		headers: {Authorization: token},
	}).catch(() => undefined);
	const answer = res?.ok
		? await res
				.clone()
				.json()
				.catch(() => null)
		: null;
	const invite = answer as botjsonfetch | null;
	if (!invite?.bot || !invite.application || !Array.isArray(invite.guilds)) return refusalText(res);
	return invite;
}

/** Adds the bot `clientId` to server `guildId`: true when it's added, else the line saying why. */
export async function authorizeBot(
	api: string,
	token: string,
	clientId: string,
	guildId: string,
	permissions: string | null,
): Promise<true | string> {
	const params = new URLSearchParams([["client_id", clientId]]);
	const res = await fetch(api + "/oauth2/authorize?" + params, {
		method: "POST",
		body: JSON.stringify({authorize: true, guild_id: guildId, permissions}),
		headers: {"Content-type": "application/json; charset=UTF-8", Authorization: token},
	}).catch(() => undefined);
	return res?.ok || refusalText(res);
}
