/**
 * The three privileged gateway intents a self-serve application can toggle on itself, and how
 * the edit form's checkboxes fold into the application's `flags` field.
 *
 * Each intent has a full bit (granted out of band, e.g. by the instance owner) and a limited
 * bit (what self-serve toggling changes): a toggle shows on when either is set, and flipping
 * it changes only the limited bit, never the full one. Every other flag passes through as
 * read. A bot that requests an intent its application lacks the flag for is rejected at
 * identify with a 4014 gateway error.
 */

export const INTENT_LIMITED_BITS = {
	presence: 1 << 13,
	guildMembers: 1 << 15,
	messageContent: 1 << 19,
} as const;

export const INTENT_FULL_BITS = {
	presence: 1 << 12,
	guildMembers: 1 << 14,
	messageContent: 1 << 18,
} as const;

export type IntentName = keyof typeof INTENT_LIMITED_BITS;

/** Whether a read `flags` value is a non-negative 31-bit integer safe for 32-bit bitwise ops. */
export function isFlagsValue(x: unknown): x is number {
	return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0x7fffffff;
}

/** What the edit form shows for an intent: on when its limited OR its full bit is set. */
export function intentShown(read: number, name: IntentName): boolean {
	return (read & (INTENT_LIMITED_BITS[name] | INTENT_FULL_BITS[name])) !== 0;
}

/** Rebuilds the flags field from the read value with only the limited bits replaced. */
export function foldIntentFlags(read: number, toggles: Record<IntentName, boolean>): number {
	let flags = read;
	for (const name of Object.keys(INTENT_LIMITED_BITS) as IntentName[]) {
		if (toggles[name]) {
			flags |= INTENT_LIMITED_BITS[name];
		} else {
			flags &= ~INTENT_LIMITED_BITS[name];
		}
	}
	return flags;
}
