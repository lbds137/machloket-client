/** The query after a leading "/" when the draft is still a bare command name (words only), else undefined. */
export function slashCommandQuery(draft: string): string | undefined {
	// Whitespace is required between words, so a word can't be split two ways: linear, not
	// exponential, on a long word that ends in punctuation.
	const command = draft.match(/^\/(\s*\w+(?:\s+\w+)*)?$/);
	return command ? (command[1] ?? "") : undefined;
}
