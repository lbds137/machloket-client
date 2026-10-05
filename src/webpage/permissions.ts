import {I18n} from "./i18n.js";

class Permissions {
	allow: bigint;
	deny: bigint;
	readonly hasDeny: boolean;
	constructor(allow: string, deny: string = "") {
		this.hasDeny = Boolean(deny);
		try {
			this.allow = BigInt(allow);
			this.deny = BigInt(deny);
		} catch {
			this.allow = 0n;
			this.deny = 0n;
			console.error(
				`Something really stupid happened with a permission with allow being ${allow} and deny being, ${deny}, execution will still happen, but something really stupid happened, please report if you know what caused this.`,
			);
		}
	}
	getPermissionbit(b: number, big: bigint): boolean {
		return Boolean((big >> BigInt(b)) & 1n);
	}
	setPermissionbit(b: number, state: boolean, big: bigint): bigint {
		const bit = 1n << BigInt(b);
		return (big & ~bit) | (BigInt(state) << BigInt(b)); //thanks to geotale for this code :3
	}
	//private static info: { name: string; readableName: string; description: string }[];
	static *info(): Generator<{name: string; readableName: string; description: string}> {
		for (const thing of this.permisions) {
			if (thing === "UNUSED_47") continue; // reserved bits have no editor UI
			yield {
				name: thing,
				readableName: I18n.permissions.readableNames[thing](),
				description: I18n.permissions.descriptions[thing](thing),
			};
		}
	}
	static permisions = [
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
		// Discord reserves bit 47; the array's index is the bit, so a never-queried
		// placeholder holds the position.
		"UNUSED_47",
		"SET_VOICE_CHANNEL_STATUS",
		"SEND_POLLS",
		"USE_EXTERNAL_APPS",
		"PIN_MESSAGES",
		"BYPASS_SLOWMODE",
	] as const;
	static categories: Record<string, readonly (typeof this.permisions)[number][]> = {
		general: [
			"VIEW_CHANNEL",
			"MANAGE_CHANNELS",
			"MANAGE_ROLES",
			"CREATE_GUILD_EXPRESSIONS",
			"MANAGE_GUILD_EXPRESSIONS",
			"VIEW_AUDIT_LOG",
			"MANAGE_WEBHOOKS",
			"MANAGE_GUILD",
		],
		membership: [
			"CREATE_INSTANT_INVITE",
			"CHANGE_NICKNAME",
			"MANAGE_NICKNAMES",
			"KICK_MEMBERS",
			"BAN_MEMBERS",
			"MODERATE_MEMBERS",
		],
		text: [
			"SEND_MESSAGES",
			"SEND_MESSAGES_IN_THREADS",
			"CREATE_PUBLIC_THREADS",
			"CREATE_PRIVATE_THREADS",
			"EMBED_LINKS",
			"ATTACH_FILES",
			"ADD_REACTIONS",
			"USE_EXTERNAL_EMOJIS",
			"USE_EXTERNAL_STICKERS",
			"MENTION_EVERYONE",
			"MANAGE_MESSAGES",
			"PIN_MESSAGES",
			"BYPASS_SLOWMODE",
			"MANAGE_THREADS",
			"READ_MESSAGE_HISTORY",
			"SEND_TTS_MESSAGES",
			"SEND_VOICE_MESSAGES",
			"SEND_POLLS",
		],
		voice: [
			"CONNECT",
			"SPEAK",
			"STREAM",
			"USE_SOUNDBOARD",
			"USE_EXTERNAL_SOUNDS",
			"USE_VAD",
			"PRIORITY_SPEAKER",
			"MUTE_MEMBERS",
			"DEAFEN_MEMBERS",
			"MOVE_MEMBERS",
			"REQUEST_TO_SPEAK",
		],
		apps: ["USE_APPLICATION_COMMANDS", "USE_EMBEDDED_ACTIVITIES", "USE_EXTERNAL_APPS"],
		events: ["CREATE_EVENTS", "MANAGE_EVENTS"],
		advanced: ["ADMINISTRATOR"],
	} as const;
	getPermission(name: string): number {
		// indexOf answers -1 for a name not in the list, which would read a shifted bit.
		const bit = Permissions.permisions.indexOf(name as any);
		if (bit === -1) {
			console.error(name + " is not found in map", Permissions.permisions);
			return 0;
		}
		if (this.getPermissionbit(bit, this.allow)) {
			return 1;
		} else if (this.getPermissionbit(bit, this.deny)) {
			return -1;
		} else {
			return 0;
		}
	}
	hasPermission(name: string, adminOverride = true): boolean {
		if (this.deny) {
			console.warn(
				"This function may of been used in error, think about using getPermision instead",
			);
		}
		const bit = Permissions.permisions.indexOf(name as any);
		if (bit === -1) {
			console.error(name + " is not found in map", Permissions.permisions);
			return false;
		}
		if (this.getPermissionbit(bit, this.allow)) return true;
		if (name !== "ADMINISTRATOR" && adminOverride) return this.hasPermission("ADMINISTRATOR");
		return false;
	}
	setPermission(name: string, setto: number): void {
		const bit = Permissions.permisions.indexOf(name as any);
		if (bit === -1) {
			return console.error(
				"Tried to set permission to " + setto + " for " + name + " but it doesn't exist",
			);
		}

		if (setto === 0) {
			this.deny = this.setPermissionbit(bit, false, this.deny);
			this.allow = this.setPermissionbit(bit, false, this.allow);
		} else if (setto === 1) {
			this.deny = this.setPermissionbit(bit, false, this.deny);
			this.allow = this.setPermissionbit(bit, true, this.allow);
		} else if (setto === -1) {
			this.deny = this.setPermissionbit(bit, true, this.deny);
			this.allow = this.setPermissionbit(bit, false, this.allow);
		} else {
			console.error("invalid number entered:" + setto);
		}
	}
}
export {Permissions};
