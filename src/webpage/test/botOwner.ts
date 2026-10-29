import type {Localuser} from "../localuser";

/** The bot-settings fixtures' owner: a bare Localuser carrying the fields the settings page
 * and the profile editor read. Fixture Users are built with dontclone=true —
 * cache-independent by design; production builds bot users through checkuser's userMap
 * instead. */
export async function makeBotOwner(api: string, cdn: string = api) {
	// Localuser is imported dynamically: a test entry must import ./localuser before
	// anything else, and a static import here would reorder that entry for every importer.
	const {Localuser: LS} = await import("../localuser");
	return Object.assign(Object.create(LS.prototype), {
		info: {api, cdn, wellknown: cdn},
		headers: {},
		userMap: new Map(),
		guilds: [],
	}) as InstanceType<typeof Localuser>;
}
