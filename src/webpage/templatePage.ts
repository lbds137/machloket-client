import {I18n} from "./i18n.js";
import {templateSkim} from "./jsontypes.js";
import {getapiurls, getDefaultInstanceUrl, instancefetch} from "./utils/utils.js";
import {getBulkUsers, Specialuser} from "./utils/utils.js";
import {sameApi, sameInstance} from "./utils/instanceMatch.js";
import {refusalText} from "./utils/refusalText.js";
import {instanceUnreachableText} from "./utils/instanceUnreachable.js";
import {isValidTemplateCode} from "./utils/templateCode.js";
if (window.location.pathname.startsWith("/template"))
	(async () => {
		const users = getBulkUsers();
		await instancefetch;
		// Without ?instance=, the default instance (as the oauth2 page does).
		const well =
			new URLSearchParams(window.location.search).get("instance") || getDefaultInstanceUrl();
		// template.html ships the button hidden and unlabelled (it holds its space): it shows once
		// the language is loaded and the label known.
		const useButton = document.getElementById("usetemplate")!;
		const labelButton = (canUse: boolean) => {
			useButton.textContent = canUse ? I18n.useTemplateButton() : I18n.htmlPages.noAccount();
			useButton.style.visibility = "";
		};
		/** No instance to look the template up on or use it with, or no template to look up: the
		 * button stays hidden. */
		const showNoInstance = async (message: () => string) => {
			await I18n.done;
			document.getElementById("templatename")!.textContent = I18n.templateHeading();
			document.getElementById("templatedescription")!.textContent = message();
		};
		// The path is anyone's to write, and the code goes into the request's path: one that
		// isn't a template code is never asked for.
		const code = window.location.pathname.split("/")[2];
		if (!isValidTemplateCode(code)) {
			return await showNoInstance(() => I18n.guild.invalidTemplate());
		}
		// No ?instance= and none listed to default to (an empty instance list): nothing was
		// unreachable, the client has no instance at all.
		if (!well) return await showNoInstance(() => I18n.noInstanceConfigured());
		const joinable: Specialuser[] = [];

		for (const key in users.users) {
			if (Object.prototype.hasOwnProperty.call(users.users, key)) {
				const user: Specialuser = users.users[key];
				if (sameInstance(user.serverurls.wellknown, well)) {
					joinable.push(user);
				}
			}
		}

		let urls: {api: string; cdn: string} | undefined;

		if (!joinable.length) {
			const out = await getapiurls(well);
			if (out) {
				urls = out;
				for (const key in users.users) {
					if (Object.prototype.hasOwnProperty.call(users.users, key)) {
						const user: Specialuser = users.users[key];
						if (sameApi(user.serverurls.api, out.api)) {
							joinable.push(user);
						}
					}
				}
			} else {
				// The template's instance can't be found (unreachable, or not an instance).
				return await showNoInstance(() => instanceUnreachableText(well));
			}
		} else {
			urls = joinable[0].serverurls;
		}
		await I18n.done;
		labelButton(joinable.length > 0);

		fetch(`${urls!.api}/guilds/templates/${code}`, {
			method: "GET",
			// Signed out, the instance may refuse (Spacebar wants a token here): the page then names
			// no template (a generic heading), and the button still leads to sign-in.
			headers: joinable[0] ? {Authorization: joinable[0].token} : {},
		})
			.catch(() => undefined)
			.then(async (response) => {
				const title = document.getElementById("templatename")!;
				const description = document.getElementById("templatedescription")!;
				// Cloned: refusalText reads the body below when it isn't the template.
				const json = response?.ok
					? await response
							.clone()
							.json()
							.catch(() => null)
					: null;
				if (typeof (json as templateSkim | null)?.name === "string") {
					const template = json as templateSkim;
					title.textContent = I18n.useTemplate(template.name);
					description.textContent = template.description;
					return;
				}
				// No template to name (refused, no answer, a 200 that isn't the template's JSON):
				// a generic heading rather than an untitled card.
				title.textContent = I18n.templateHeading();
				// Signed out, a refusal is expected and the button leads to sign-in: no reason shown.
				if (response && !response.ok && !joinable[0]) return;
				// Otherwise the body says why: no answer at all (not an unhandled rejection), the
				// instance's refusal, or the status of an answer that isn't the template.
				description.textContent = await refusalText(response);
			});

		function showAccounts(): void {
			const table = document.createElement("dialog");
			for (const user of joinable) {
				const userinfo = document.createElement("div");
				userinfo.classList.add("flexltr", "switchtable");

				const pfp = document.createElement("img");
				pfp.src = user.pfpsrc;
				pfp.classList.add("pfp");
				userinfo.append(pfp);

				const userDiv = document.createElement("div");
				userDiv.classList.add("userinfo");
				userDiv.textContent = user.username;
				userDiv.append(document.createElement("br"));

				const span = document.createElement("span");
				span.textContent = user.serverurls.wellknown.replace("https://", "").replace("http://", "");
				span.classList.add("serverURL");
				userDiv.append(span);

				userinfo.append(userDiv);
				table.append(userinfo);

				userinfo.addEventListener("click", () => {
					const search = new URLSearchParams();
					search.set("templateID", code);
					sessionStorage.setItem("currentuser", user.uid);
					window.location.assign("/channels/@me?" + search);
				});
			}

			if (!joinable.length) {
				const l = new URLSearchParams("?");
				l.set("goback", window.location.href);
				l.set("instance", well!);
				window.location.href = "/login?" + l.toString();
			}

			table.classList.add("flexttb", "accountSwitcher");
			document.body.append(table);
		}

		useButton.addEventListener("click", showAccounts);
	})();
