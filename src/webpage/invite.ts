import {I18n} from "./i18n.js";
import {AccountSwitcher} from "./utils/switcher.js";
import {createImg, getapiurls} from "./utils/utils.js";
import {getBulkUsers, Specialuser} from "./utils/utils.js";
import {sameApi, sameInstance} from "./utils/instanceMatch.js";
import {acceptInvite} from "./utils/acceptInvite.js";
// Re-exported: the accept lives in utils (no page side effects), and this page's tests import it here.
export {acceptInvite};
/** How long an accept waits for the invite's details before it lands on the home page. */
export const GUILD_WAIT_MS = 3000;
/** The page's navigation, behind an object so a test can observe where an accept lands. */
export const pageNav = {
	go(href: string) {
		window.location.href = href;
	},
};
/** The invite's guild once its details load: undefined if they fail or take longer than `ms`. */
function guildWithin(loaded: Promise<any>, ms: number): Promise<any> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), ms);
	});
	return Promise.race([loaded.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}
if (window.location.pathname.startsWith("/invite"))
	(async () => {
		const users = getBulkUsers();
		const well = new URLSearchParams(window.location.search).get("instance") || "Spacebar";
		const joinable: Specialuser[] = [];

		for (const key in users.users) {
			if (Object.prototype.hasOwnProperty.call(users.users, key)) {
				const user: Specialuser = users.users[key];
				if (well && sameInstance(user.serverurls.wellknown, well)) {
					joinable.push(user);
				}
				console.log(user);
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
						console.log(user);
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
			document.getElementById("AcceptInvite")!.textContent = I18n.htmlPages.noAccount();
		}

		const code = window.location.pathname.split("/")[2];
		// Resolves to the invite's guild once the details have shown; the accept waits on it.
		const guildLoaded = fetch(`${urls!.api}/invites/${code}`, {
			method: "GET",
		})
			.then((response) => response.json())
			.then((json) => {
				if (json.code === 404) {
					document.getElementById("AcceptInvite")?.remove();
					document.getElementById("invitename")!.textContent = I18n.invite.notFound();
					document.getElementById("invitedescription")!.textContent = "";
					return undefined;
				}
				const guildjson = json.guild;
				document.getElementById("invitename")!.textContent = guildjson.name;
				// An invite can have no inviter (a vanity or system invite).
				document.getElementById("invitedescription")!.textContent = json.inviter
					? I18n.invite.longInvitedBy(json.inviter.username, guildjson.name)
					: I18n.invite.invitedTo(guildjson.name);
				if (guildjson.discovery_splash) {
					const img = createImg(
						`${urls!.cdn}/discovery-splashes/${guildjson.id}/${guildjson.discovery_splash}.png`,
					);
					img.classList.add("inviteBG");
					document.body.prepend(img);
					document.getElementById("invitebody")?.classList.add("moreShadow");
				}
				if (guildjson.banner) {
					const img = createImg(`${urls!.cdn}/banners/${guildjson.id}/${guildjson.banner}.png`);
					document.getElementById("inviteBanner")!.append(img);
				}
				if (guildjson.icon) {
					const img = document.createElement("img");
					img.src = `${urls!.cdn}/icons/${guildjson.id}/${guildjson.icon}.png`;
					img.classList.add("inviteGuild");
					document.getElementById("inviteimg")!.append(img);
				} else {
					const txt = guildjson.name
						.replace(/'s /g, " ")
						.replace(/\w+/g, (word: any[]) => word[0])
						.replace(/\s/g, "");
					const div = document.createElement("div");
					div.textContent = txt;
					div.classList.add("inviteGuild");
					document.getElementById("inviteimg")!.append(div);
				}
				return guildjson;
			});

		async function showAccounts() {
			console.log("showing!");
			const user = await new AccountSwitcher(
				(user) => {
					return !!(well && sameInstance(user.serverurls.wellknown, well));
				},
				{
					loginText: () => I18n.login.login(),
					createOpt: true,
					loginurl:
						"/login?" +
						new URLSearchParams([
							["goback", window.location.href],
							["instance", well],
							["invite", code],
						]),
					registerurl:
						"/register?" +
						new URLSearchParams([
							["goback", window.location.href],
							["instance", well],
							["invite", code],
						]),
				},
			).show();
			acceptInvite(urls!.api, code, user.token).then(async (result) => {
				// The in-app accept shows the server's message in its form; this page has no form.
				if (!result.ok) return alert(result.message);
				users.currentuser = user.uid;
				sessionStorage.setItem("currentuser", user.uid);
				localStorage.setItem("userinfos", JSON.stringify(users));
				// The details may still be loading (or have failed): wait a while for them rather than
				// read an unset guild or stall. With no guild to name, the home page is where the join lands.
				const guildinfo = await guildWithin(guildLoaded, GUILD_WAIT_MS);
				pageNav.go("/channels/" + (guildinfo?.id ?? "@me"));
			});
		}

		document.getElementById("AcceptInvite")!.addEventListener("click", (e) => {
			e.stopImmediatePropagation();
			showAccounts();
		});
	})();
