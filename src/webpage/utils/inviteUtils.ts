export function normalizeInviteLink(text: string): string {
	return text.replace(
		// The host ends where the path, query or fragment starts (no lookalike suffixes), and the
		// match runs past the code so an `instance` after it is read too.
		/https?:\/\/(?:fermi\.chat|pax\.sovr\.top|sylvie_shy\.codeberg\.page|hoshi\.oh64\.moe)(?::\d+)?(?=[/?#])[^\s<>"']*?(?:invite\/|\?invite=)([a-zA-Z0-9]+)(?![a-zA-Z0-9])[^\s<>"']*/gi,
		(match, code) => {
			const instanceMatch = match.match(/[?&]instance=([^&\s<>"']+)/);

			if (instanceMatch) {
				let instance = instanceMatch[1];

				try {
					instance = decodeURIComponent(instance);

					if (instance.includes("://")) {
						instance = new URL(instance).hostname.replace(/^www\./, "");
					}
				} catch {}

				return `https://sbar.fyi/i/${code}?instance=${encodeURIComponent(instance)}`;
			}

			return `https://sbar.fyi/i/${code}`;
		},
	);
}
