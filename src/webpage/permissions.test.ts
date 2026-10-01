import {describe, expect, it} from "vitest";
await import("./localuser");
const {Permissions} = await import("./permissions");

/** Discord's permission bit order (discord.js PermissionsBitField, v14.27 — bit-for-bit what
 * the fork serializes per its G15 diff). Index = bit position. */
const DISCORD_ORDER = [
	"CREATE_INSTANT_INVITE",
	"KICK_MEMBERS",
	"BAN_MEMBERS",
	"ADMINISTRATOR",
	"MANAGE_CHANNELS",
	"MANAGE_GUILD",
	"ADD_REACTIONS",
	"VIEW_AUDIT_LOG",
	"PRIORITY_SPEAKER",
	"STREAM",
	"VIEW_CHANNEL",
	"SEND_MESSAGES",
	"SEND_TTS_MESSAGES",
	"MANAGE_MESSAGES",
	"EMBED_LINKS",
	"ATTACH_FILES",
	"READ_MESSAGE_HISTORY",
	"MENTION_EVERYONE",
	"USE_EXTERNAL_EMOJIS",
	"VIEW_GUILD_INSIGHTS",
	"CONNECT",
	"SPEAK",
	"MUTE_MEMBERS",
	"DEAFEN_MEMBERS",
	"MOVE_MEMBERS",
	"USE_VAD",
	"CHANGE_NICKNAME",
	"MANAGE_NICKNAMES",
	"MANAGE_ROLES",
	"MANAGE_WEBHOOKS",
	"MANAGE_GUILD_EXPRESSIONS",
	"USE_APPLICATION_COMMANDS",
	"REQUEST_TO_SPEAK",
	"MANAGE_EVENTS",
	"MANAGE_THREADS",
	"CREATE_PUBLIC_THREADS",
	"CREATE_PRIVATE_THREADS",
	"USE_EXTERNAL_STICKERS",
	"SEND_MESSAGES_IN_THREADS",
	"USE_EMBEDDED_ACTIVITIES",
	"MODERATE_MEMBERS",
	"VIEW_CREATOR_MONETIZATION_ANALYTICS",
	"USE_SOUNDBOARD",
	"CREATE_GUILD_EXPRESSIONS",
	"CREATE_EVENTS",
	"USE_EXTERNAL_SOUNDS",
	"SEND_VOICE_MESSAGES",
	"UNUSED_47", // Discord reserves bit 47
	"SET_VOICE_CHANNEL_STATUS",
	"SEND_POLLS",
	"USE_EXTERNAL_APPS",
	"PIN_MESSAGES",
	"BYPASS_SLOWMODE",
] as const;

describe("permission bit layout", () => {
	it("every flag sits at Discord's bit position", () => {
		// A wrong bit reads a permission the user doesn't have (or grants one they lack):
		// the table must match Discord bit-for-bit, name for name.
		expect([...Permissions.permisions]).toEqual([...DISCORD_ORDER]);
	});

	it("resolves a permission bit the server actually sends", () => {
		// MANAGE_MESSAGES = 1n << 13n, the message-manage check's bit.
		const perms = new Permissions((1n << 13n).toString());
		expect(perms.hasPermission("MANAGE_MESSAGES")).toBe(true);
		expect(perms.hasPermission("SEND_MESSAGES")).toBe(false);
	});
});
