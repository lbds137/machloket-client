/** Per-word match: every whitespace-separated token of `search` must appear, case-insensitively,
 * as a substring of a distinct `label` word, with the matched words in increasing order (an
 * in-order subsequence over the words) — so "char browse" finds "/character browse". The score
 * is the matched tokens' total length over the label's, over 1.6, which keeps it below the
 * case-insensitive full-substring tier's /1.4 for strings of the same length. */
export function tokenMatchRatio(label: string, search: string): number {
	const trimmed = search.trim();
	if (!trimmed.length || !label.length) return 0;
	const tokens = trimmed.split(/\s+/);
	const words = label.split(/\s+/);

	let wordIdx = 0;
	let tokenLenSum = 0;

	for (const token of tokens) {
		const lowerToken = token.toLowerCase();
		let matched = false;
		while (wordIdx < words.length) {
			const word = words[wordIdx++];
			if (word.toLowerCase().includes(lowerToken)) {
				matched = true;
				break;
			}
		}
		if (!matched) return 0;
		tokenLenSum += token.length;
	}

	return tokenLenSum / label.length / 1.6;
}
