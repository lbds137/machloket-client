/** The index's per-command `permissions` map. Typed after commandJson's shape, with the entry
 * values widened to `boolean | null`: a server may serialize an unset entry as null, and this
 * boundary treats null exactly as absent. */
interface CommandPermissionEntries {
	user?: boolean | null;
	roles?: {[id: string]: boolean | null};
	channels?: {[id: string]: boolean | null};
}

/** Per-command overrides, pinned 2026-10-16 with the Machloket server session (its invoke path
 * enforces the same table). Tier 1 — the bypasses (guild owner, app owner, ADMINISTRATOR) — is
 * the caller's (Guild.memberCanSee). Here the channel tier outranks the guild tier, and within
 * a tier any explicit allow beats any explicit deny; nothing applicable returns null, the
 * caller's cue to fall through to default_member_permissions. */
export function commandAllowedFor(
	entries: CommandPermissionEntries | null | undefined,
	channelId: string | undefined,
	roleIds: ReadonlySet<string>,
): boolean | null {
	if (!entries) return null;

	// Channel tier: a ruling about WHERE beats a ruling about WHO (the guild tier below).
	const channelEntry = channelId === undefined ? undefined : entries.channels?.[channelId];
	if (channelEntry === true || channelEntry === false) return channelEntry;

	// Guild tier: allow-wins within the tier across the user switch and the member's roles.
	let denied = false;
	if (entries.user === true) return true;
	if (entries.user === false) denied = true;
	for (const roleId of roleIds) {
		const roleEntry = entries.roles?.[roleId];
		if (roleEntry === true) return true;
		if (roleEntry === false) denied = true;
	}
	return denied ? false : null;
}
