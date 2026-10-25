const RESERVED = new Set(["everyone", "here"]);

export function resolveTypedMentions(
	text: string,
	candidates: {id: string; names: string[]}[],
): string {
	if (!text.includes("@") || candidates.length === 0) return text;

	const ownerByName = new Map<string, string | null>();
	for (const candidate of candidates) {
		for (const name of candidate.names) {
			if (!name || RESERVED.has(name)) continue;
			const existing = ownerByName.get(name);
			if (existing === undefined) {
				ownerByName.set(name, candidate.id);
			} else if (existing !== candidate.id) {
				ownerByName.set(name, null);
			}
		}
	}
	if (ownerByName.size === 0) return text;

	const names = [...ownerByName.keys()].sort((a, b) => b.length - a.length);

	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "<" && text[i + 1] === "@") {
			const close = text.indexOf(">", i + 2);
			if (close !== -1 && !text.slice(i + 2, close).includes("<")) {
				out += text.slice(i, close + 1);
				i = close;
				continue;
			}
		}
		if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]))) {
			let matched: string | undefined;
			for (const name of names) {
				if (!text.startsWith(name, i + 1)) continue;
				const end = i + 1 + name.length;
				if (end === text.length || /\s/.test(text[end])) {
					matched = name;
					break;
				}
			}
			if (matched !== undefined) {
				const id = ownerByName.get(matched);
				out += id !== null && id !== undefined ? `<@${id}>` : `@${matched}`;
				i += matched.length;
				continue;
			}
		}
		out += text[i];
	}
	return out;
}
