import {I18n} from "../i18n.js";
import {getapiurls, getDefaultInstanceUrl, instancefetch} from "../utils/utils.js";
import {getBulkUsers, Specialuser} from "../utils/utils.js";
import {Permissions} from "../permissions.js";
import {sameApi, sameInstance} from "../utils/instanceMatch.js";
import {authorizeBot, botjsonfetch, fetchBotInvite} from "./botInvite.js";
import {instanceUnreachableText} from "../utils/instanceUnreachable.js";
if (window.location.pathname.startsWith("/oauth2")) {
	const params = new URLSearchParams(window.location.search);
	await instancefetch;
	const well = params.get("instance") || getDefaultInstanceUrl();
	// No ?instance= and none listed to default to (an empty instance list): no instance to add the
	// bot on (nothing was unreachable: the client has none at all), so the button stays hidden.
	if (!well) await showNoInstance(() => I18n.noInstanceConfigured());
	else await showBotInvite(well, params);
}

/** The card's heading and message when there is no instance to add the bot on. */
async function showNoInstance(message: () => string) {
	await I18n.done;
	const title = document.getElementById("invitename");
	if (title) title.textContent = I18n.invite.botHeading();
	const desc = document.getElementById("invitedescription");
	if (desc) desc.textContent = message();
}

async function showBotInvite(well: string, params: URLSearchParams) {
	const users = getBulkUsers();
	const permstr = params.get("permissions");
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
			// The bot's instance can't be found (unreachable, or not an instance): the page says what
			// failed, and with no urls the rest below does nothing (the button stays hidden).
			await showNoInstance(() => instanceUnreachableText(well));
		}
	} else {
		urls = joinable[0].serverurls;
	}

	await I18n.done;
	function showGuilds(user: Specialuser) {
		if (!urls) return;
		fetchBotInvite(urls.api, user.token, window.location.search).then((json) => {
			if (typeof json === "string") return alert(json);
			const guilds: botjsonfetch["guilds"] = [];
			for (const guild of json.guilds) {
				const permisions = new Permissions(guild.permissions);
				if (permisions.hasPermission("MANAGE_GUILD")) {
					guilds.push(guild);
				}
			}
			const dialog = document.createElement("dialog");
			dialog.classList.add("flexttb", "accountSwitcher");
			const h1 = document.createElement("h1");
			dialog.append(h1);
			h1.textContent = I18n.invite.botPickServer();
			const select = document.createElement("select");
			const selectSpan = document.createElement("span");
			selectSpan.classList.add("selectspan");
			const selectArrow = document.createElement("span");
			selectArrow.classList.add("svgicon", "svg-category", "selectarrow");
			for (const guild of guilds) {
				const option = document.createElement("option");
				option.textContent = guild.name;
				option.value = guild.id;
				select.append(option);
			}
			selectSpan.append(select);
			selectSpan.append(selectArrow);
			dialog.append(selectSpan);
			const button = document.createElement("button");
			button.textContent = I18n.invite.botInviteButton();
			dialog.append(button);
			button.onclick = () => {
				const clientId = params.get("client_id") as string;
				authorizeBot(urls.api, user.token, clientId, select.value, permstr).then((added) =>
					alert(added === true ? I18n.invite.botAdded() : added),
				);
			};
			document.body.append(dialog);
		});
	}
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
				table.remove();
				showGuilds(user);
			});
		}

		const td = document.createElement("div");
		td.classList.add("switchtable");
		td.textContent = I18n.invite.loginOrCreateAccount();
		td.addEventListener("click", () => {
			const l = new URLSearchParams("?");
			l.set("goback", window.location.href);
			l.set("instance", well);
			window.location.href = "/login?" + l.toString();
		});

		if (!joinable.length) {
			const l = new URLSearchParams("?");
			l.set("goback", window.location.href);
			l.set("instance", well);
			window.location.href = "/login?" + l.toString();
		}

		table.append(td);
		table.classList.add("flexttb", "accountSwitcher");
		document.body.append(table);
	}
	const user = joinable[0];
	if (!user && urls) {
		// Signed out, the bot's details never load: a generic heading, not an untitled card.
		const title = document.getElementById("invitename");
		if (title) title.textContent = I18n.invite.botHeading();
	}
	if (user && urls) {
		fetchBotInvite(urls.api, user.token, window.location.search).then((json) => {
			const title = document.getElementById("invitename");
			// No invite to show (an unknown bot, an expired login…): say why in its place.
			if (typeof json === "string") {
				if (title) title.textContent = json;
				return;
			}
			if (title) {
				title.textContent = I18n.invite.botTitle(json.bot.username);
			}
			const desc = document.getElementById("invitedescription");
			if (desc) {
				desc.textContent = json.application.description;
			}
			const pfp = document.getElementById("inviteimg") as HTMLImageElement;
			if (json.bot.avatar !== null) {
				pfp.src = `${urls.cdn}/avatars/${json.bot.id}/${json.bot.avatar}.png`;
			} else {
				const int = Number((BigInt(json.bot.id) >> 22n) % 6n);
				pfp.src = `${urls.cdn}/embed/avatars/${int}.png`;
			}
			const perms = document.getElementById("permissions") as HTMLDivElement;

			if (perms && permstr) {
				perms.children[0].textContent = I18n.htmlPages.idpermissions();
				perms.hidden = false;
				const permisions = new Permissions(permstr);
				for (const perm of Permissions.info()) {
					if (permisions.hasPermission(perm.name, false)) {
						const div = document.createElement("div");
						const h2 = document.createElement("h2");
						h2.textContent = perm.readableName;
						div.append(h2, perm.description);
						div.classList.add("flexttb");
						perms.append(div);
					}
				}
			}
		});
	}
	const AcceptInvite = document.getElementById("AcceptInvite");
	if (AcceptInvite && urls) {
		AcceptInvite.addEventListener("click", showAccounts);
		AcceptInvite.textContent = joinable.length
			? I18n.htmlPages.addBot()
			: I18n.invite.botNoAccount();
		// authorize.html ships it hidden and unlabelled: it shows once labelled.
		AcceptInvite.style.visibility = "";
	}
}
