const STORAGE_KEY = "emojiSkinTone";

/** Synthesizes the Fitzpatrick skin-tone variant (tones 1..5 -> U+1F3FB..U+1F3FF) for a
 * skin-tone-capable base emoji; inserts the modifier after the first codepoint (dropping an
 * immediately following U+FE0F per RGI), or returns the base unchanged for tone 0 / invalid. */
export function applySkinTone(emoji: string, tone: number): string {
	if (!Number.isInteger(tone) || tone < 1 || tone > 5) {
		return emoji;
	}
	const cps = [...emoji];
	const first = cps[0];
	if (!first) return emoji;
	const mod = String.fromCodePoint(0x1f3fb + tone - 1);
	const restStart = cps[1] === "\ufe0f" ? 2 : 1;
	return first + mod + cps.slice(restStart).join("");
}

/** Reads the persisted default skin tone (0..5) from localStorage under `emojiSkinTone`.
 * Unset, corrupt JSON, wrong type, out-of-range, or non-integer values read as 0. */
export function getSkinTone(): number {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) return 0;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
			return 0;
		}
		return parsed;
	} catch {
		return 0;
	}
}

/** Persists the default skin tone (0..5) to localStorage under `emojiSkinTone`. */
export function setSkinTone(tone: number): void {
	try {
		const valid = Number.isInteger(tone) && tone >= 0 && tone <= 5 ? tone : 0;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
	} catch {
		// A full or blocked storage loses the persisted default; the picker still works.
	}
}

/** Dual-tone ZWJ compositions have no single-tone RGI variants; keep base glyph and hide badge. */
export function isDualToneEmoji(emoji: string): boolean {
	const cps = Array.from(emoji, (ch) => ch.codePointAt(0));
	return (
		cps.includes(0x1f48b) ||
		(cps.includes(0x200d) && (cps.includes(0x2764) || cps.includes(0x1f91d)))
	);
}
