import {I18n} from "./i18n.js";
import {templateSkim} from "./jsontypes.js";
import {getapiurls, getDefaultInstanceUrl, instancefetch} from "./utils/utils.js";
import {getBulkUsers, Specialuser} from "./utils/utils.js";
import {sameApi, sameInstance} from "./utils/instanceMatch.js";
import {refusalText} from "./utils/refusalText.js";
if (window.location.pathname.startsWith("/template"))
	(async () => {
		const users = getBulkUsers();
		await instancefetch;
		// Without ?instance=, the default instance (as the oauth2 page does).
		const well =
			new URLSearchParams(window.location.search).get("instance") || getDefaultInstanceUrl();
		if (!well) {
			await I18n.done;
			document.getElementById("usetemplate")!.textContent = I18n.htmlPages.noAccount();
			return;
		}
		const joinable: Specialuser[] = [];

		for (const key in users.users) {
			if (Object.prototype.hasOwnProperty.call(users.users, key)) {
				const user: Specialuser = users.users[key];
				if (well && sameInstance(user.serverurls.wellknown, well)) {
					joinable.push(user);
				}
			}
		}

		let urls: {api: string; cdn: string} | undefined;

		if (!joinable.length && well) {
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
				throw new Error("Someone needs to handle the case where the servers don't exist");
			}
		} else {
			urls = joinable[0].serverurls;
		}
		await I18n.done;
		if (!joinable.length) {
			document.getElementById("usetemplate")!.textContent = I18n.htmlPages.noAccount();
		}

		const code = window.location.pathname.split("/")[2];

		fetch(`${urls!.api}/guilds/templates/${code}`, {
			method: "GET",
			// Signed out, the instance may refuse (Spacebar wants a token here): name no template
			// then, rather than an undefined one. The button still leads to sign-in.
			headers: joinable[0] ? {Authorization: joinable[0].token} : {},
		})
			.catch(() => undefined)
			.then(async (response) => {
				const description = document.getElementById("templatedescription")!;
				if (!response) {
					// No answer at all: said in the page body, not an unhandled rejection.
					description.textContent = await refusalText(response);
					return;
				}
				if (!response.ok) return;
				const json = await response.json().catch(() => null);
				if (!json) {
					// A 200 that isn't the template's JSON (a proxy's page). The body is consumed,
					// so refusalText can only give its status.
					description.textContent = await refusalText(response);
					return;
				}
				if (typeof (json as templateSkim).name !== "string") {
					// A 200 of some other shape would write useTemplate(undefined) into the page.
					description.textContent = await refusalText(response);
					return;
				}
				const template = json as templateSkim;
				document.getElementById("templatename")!.textContent = I18n.useTemplate(template.name);
				description.textContent = template.description;
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

		document.getElementById("usetemplate")!.addEventListener("click", showAccounts);
		document.getElementById("usetemplate")!.textContent = I18n.useTemplateButton();
	})();
