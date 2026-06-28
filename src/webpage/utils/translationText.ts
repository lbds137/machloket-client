const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const PLACEHOLDER_RE = /\uE000CB(\d+)\uE001/g;

export type PreparedTranslationText = {
	text: string;
	restore: (translated: string) => string;
};

export function prepareTextForTranslation(raw: string): PreparedTranslationText {
	const blocks: string[] = [];

	const text = raw.replace(CODE_BLOCK_RE, (match) => {
		const index = blocks.length;
		blocks.push(match);
		return `\uE000CB${index}\uE001`;
	});

	return {
		text,
		restore: (translated) =>
			translated.replace(PLACEHOLDER_RE, (_, index) => blocks[Number(index)] ?? ""),
	};
}

export function hasTranslatableContent(raw: string): boolean {
	const {text} = prepareTextForTranslation(raw);
	return text.replace(PLACEHOLDER_RE, "").trim().length > 0;
}

export function isCodeOnlyMessage(raw: string): boolean {
	return raw.trim().length > 0 && !hasTranslatableContent(raw);
}
