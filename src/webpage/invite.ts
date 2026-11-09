import {I18n} from "./i18n.js";
import {AccountSwitcher} from "./utils/switcher.js";
import {createImg, getapiurls} from "./utils/utils.js";
import {getBulkUsers, Specialuser} from "./utils/utils.js";
import {sameApi, sameInstance} from "./utils/instanceMatch.js";
import {acceptInvite} from "./utils/acceptInvite.js";
import {instanceUnreachableText} from "./utils/instanceUnreachable.js";
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
				// The invite's instance can't be found (unreachable, or not an instance): there is
				// nothing to accept with, so the button stays hidden and the page says what failed.
				await I18n.done;
				document.getElementById("invitename")!.textContent = I18n.invite.heading();
				document.getElementById("invitedescription")!.textContent = instanceUnreachableText(well);
				return;
			}
		} else {
			urls = joinable[0].serverurls;
		}
		await I18n.done;
		// invite.html ships the button hidden and unlabelled (it holds its space): only now is the
		// language loaded and the label known.
		const acceptButton = document.getElementById("AcceptInvite")!;
		acceptButton.textContent = joinable.length
			? I18n.invite.acceptInvite()
			: I18n.htmlPages.noAccount();
		acceptButton.style.visibility = "";

		const code = window.location.pathname.split("/")[2];
		// Resolves to the invite's guild once the details have shown; the accept waits on it.
		const guildLoaded = fetch(`${urls!.api}/invites/${code}`, {
			method: "GET",
		})
			.catch(() => undefined)
			.then(async (response) => {
				if (response?.ok) return await response.json().catch(() => null);
				// A dead invite is a 404 (code 10006); any other failure says nothing about the
				// invite, so the page keeps its Accept.
				if (response?.status === 404) return null;
				// No name came back: a generic heading above the failure.
				document.getElementById("invitename")!.textContent = I18n.invite.heading();
				document.getElementById("invitedescription")!.textContent = I18n.requestFailed(
					response ? "HTTP " + response.status : "offline",
				);
				return undefined;
			})
			.then((json) => {
				if (json === undefined) return undefined;
				if (!json?.guild) {
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
			acceptInvite(urls!.api, code, user.token)
				.then(
					async (result) => {
						// The in-app accept shows the server's message in its form; this page has no form.
						if (!result.ok) return alert(result.message);
						users.currentuser = user.uid;
						sessionStorage.setItem("currentuser", user.uid);
						// Only the default account for new tabs is lost if this write fails (a full
						// localStorage): the account itself is already stored, and the app boots this tab's
						// pick from sessionStorage, so the landing goes ahead. Throwing here would send the
						// user round "accept again", which hits the same full storage.
						try {
							localStorage.setItem("userinfos", JSON.stringify(users));
						} catch (err) {
							console.error(err);
						}
						// The details may still be loading (or have failed): wait a while for them rather than
						// read an unset guild or stall. With no guild to name, the home page is where the join lands.
						const guildinfo = await guildWithin(guildLoaded, GUILD_WAIT_MS);
						pageNav.go("/channels/" + (guildinfo?.id ?? "@me"));
					},
					// Only the request's own failure (no network): a throw in the landing above isn't one.
					(err) => {
						console.error(err);
						alert(I18n.requestFailed("offline"));
					},
				)
				// A throw in the landing (the navigation) comes after the join
				// went through: logged here, not left unhandled, and the user is told the join worked.
				// Accepting again lands as already-member.
				.catch((err: unknown) => {
					console.error(err);
					alert(I18n.invite.joinedNotOpened());
				});
		}

		document.getElementById("AcceptInvite")!.addEventListener("click", (e) => {
			e.stopImmediatePropagation();
			showAccounts();
		});
	})();
