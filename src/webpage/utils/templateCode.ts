/** What a guild template's code looks like: letters, digits, `_` and `-`. A code is put into a
 * request path, so nothing that could climb out of `/guilds/templates/` (`/`, `.`, `%`, `?`, `#`)
 * is allowed. */
const TEMPLATE_CODE = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `code` may be put after `/guilds/templates/`. The `discord:` prefix (a template from
 * Discord's own list) is allowed once; what follows it has to be a code. Empty is not one. */
export function isValidTemplateCode(code: string | null | undefined): boolean {
	if (!code) return false;
	return TEMPLATE_CODE.test(code.startsWith("discord:") ? code.slice("discord:".length) : code);
}
