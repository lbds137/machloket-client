import {I18n} from "./i18n.js";
import {Dialog, FormError} from "./settings.js";
import {getapiurls, getDefaultInstanceUrl, instancefetch} from "./utils/utils.js";
await I18n.done;
/** The instance to recover on: the one last picked on the login page, else the list's default
 * (a reset link opened on a fresh browser has no picked instance). */
export async function recoveryInstance(): Promise<{api: string} | null> {
	const raw = localStorage.getItem("instanceinfo");
	if (raw) {
		try {
			const picked: unknown = JSON.parse(raw);
			if (
				picked &&
				typeof picked === "object" &&
				typeof (picked as {api?: unknown}).api === "string" &&
				(picked as {api: string}).api
			) {
				return picked as {api: string};
			}
			console.warn("instanceinfo store is unusable, using default instance");
		} catch (error) {
			console.warn("instanceinfo store is malformed, using default instance", error);
		}
	}
	await instancefetch;
	const url = getDefaultInstanceUrl();
	return url ? await getapiurls(url) : null;
}
let info: {api: string};

/** The new-password step: after the forgot step (`email` given, the link is pasted in) or from
 * the link itself (`linkToken`, already taken out of the address bar). */
function makeMenu2(email: string | void, linkToken?: string) {
	const d2 = new Dialog("");
	d2.options.addTitle(I18n.login.recovery());
	const headers = {
		"Content-Type": "application/json",
	};
	const opt = d2.float.options.addForm(
		"",
		async (obj) => {
			if ("token" in obj && typeof obj.token === "string") {
				window.location.href = "/login" + window.location.search;
			}
		},
		{
			fetchURL: info.api + "/auth/reset",
			api: info.api,
			method: "POST",
			headers,
		},
	);
	if (email !== undefined) {
		opt.addTextInput(I18n.login.pasteInfo(), "token");
	}
	opt.addTextInput(I18n.login.newPassword(), "password", {password: true});
	const p2 = opt.addTextInput(I18n.login.enterPAgain(), "password2", {password: true});
	opt.addPreprocessor((e) => {
		const obj = e as unknown as {password: string; password2?: string; token?: string};
		if (obj.token) {
			// A pasted recovery link: its token is in the fragment.
			if (URL.canParse(obj.token)) {
				obj.token = new URLSearchParams(obj.token.split("#")[1]).get("token") as string;
			}
		} else {
			obj.token = linkToken;
		}

		if (obj.password !== obj.password2) {
			throw new FormError(p2, I18n.localuser.PasswordsNoMatch());
		}
		delete obj.password2;
	});
	d2.show(false);
}
function makeMenu1() {
	const d = new Dialog("");
	d.options.addTitle(I18n.login.recovery());
	const opt = d.float.options.addForm(
		"",
		(e) => {
			if (Object.keys(e).length === 0) {
				d.hide();
				makeMenu2(email.value);
			}
		},
		{
			fetchURL: info.api + "/auth/forgot",
			api: info.api,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
		},
	);
	const email = opt.addTextInput(I18n.htmlPages.emailField(), "login");
	d.show(false);
}
/** Opens the /reset page's flow on `found`: the new-password step for a link that carries its
 * token, else the forgot-password step. */
export function openRecovery(found: {api: string}) {
	info = found;
	const linkToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
	if (linkToken) {
		// The token works like a password until it's used: keep it out of history, bookmarks
		// and anything that shows the address bar. The step below keeps it in memory.
		history.replaceState(history.state, "", window.location.pathname + window.location.search);
		makeMenu2(undefined, linkToken);
	} else {
		makeMenu1();
	}
}
if (window.location.pathname.startsWith("/reset")) {
	const found = await recoveryInstance();
	if (!found) {
		new Dialog(I18n.requestFailed("no instance")).show(false);
	} else {
		openRecovery(found);
	}
}
