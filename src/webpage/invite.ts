import {I18n} from "./i18n.js";
import {AccountSwitcher} from "./utils/switcher.js";
import {getapiurls} from "./utils/utils.js";
import {getBulkUsers, Specialuser} from "./utils/utils.js";

(async () => {
	const users = getBulkUsers();
	const well = new URLSearchParams(window.location.search).get("instance");
	const joinable: Specialuser[] = [];

	for (const key in users.users) {
		if (Object.prototype.hasOwnProperty.call(users.users, key)) {
			const user: Specialuser = users.users[key];
			if (well && user.serverurls.wellknown.includes(well)) {
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
					if (user.serverurls.api.includes(out.api)) {
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
	let guildinfo: any;

	fetch(`${urls!.api}/invites/${code}`, {
		method: "GET",
	})
		.then((response) => response.json())
		.then((json) => {
			const guildjson = json.guild;
			guildinfo = guildjson;
			document.getElementById("invitename")!.textContent = guildjson.name;
			document.getElementById("invitedescription")!.textContent = I18n.invite.longInvitedBy(
				json.inviter.username,
				guildjson.name,
			);
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
		});

	async function showAccounts() {
		console.log("showing!");
		const user = await new AccountSwitcher((user) => {
			return !!(well && user.serverurls.wellknown.includes(well));
		}).show();
		fetch(`${urls!.api}/invites/${code}`, {
			method: "POST",
			headers: {
				Authorization: user.token,
			},
		}).then(() => {
			users.currentuser = user.uid;
			sessionStorage.setItem("currentuser", user.uid);
			localStorage.setItem("userinfos", JSON.stringify(users));
			window.location.href = "/channels/" + guildinfo.id;
		});
	}

	document.getElementById("AcceptInvite")!.addEventListener("click", (e) => {
		e.stopImmediatePropagation();
		showAccounts();
	});
})();
