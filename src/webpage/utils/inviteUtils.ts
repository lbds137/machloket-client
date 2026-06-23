export function normalizeInviteLink(text: string): string {
	return text.replace(
		/https?:\/\/(fermi\.chat|pax\.sovr\.top|sylvie_shy\.codeberg\.page|hoshi\.oh64\.moe)[^\s<>"']*?(?:invite\/|\?invite=)([a-zA-Z0-9]+)/gi,
		(match, _domain, code) => {
			const instanceMatch = match.match(/[?&]instance=([^&\s<>"']+)/);

			if (instanceMatch) {
				let instance = instanceMatch[1];

				try {
					instance = decodeURIComponent(instance);

					if (instance.includes("://")) {
						instance = new URL(instance).hostname.replace(/^www\./, "");
					}
				} catch {}

				return `https://sbar.top/i/${code}?instance=${encodeURIComponent(instance)}`;
			}

			return `https://sbar.top/i/${code}`;
		},
	);
}
