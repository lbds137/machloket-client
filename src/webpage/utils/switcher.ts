import {Contextmenu} from "../contextmenu";
import {I18n} from "../i18n.js";
import {Localuser} from "../localuser.js";
import {createImg, getBulkInfo, Specialuser} from "./utils.js";
await I18n.done;
const menu = new Contextmenu<Specialuser, void>("");
menu.addButton(
	"Logout of account",
	async function () {
		await this.logout();
	},
	{color: "red"},
);
export class AccountSwitcher {
	filter: (spec: Specialuser) => boolean;
	canCreate: boolean;
	canLogOut: boolean;
	canHide: boolean;
	createOpt: boolean;
	loginText: () => string;
	loginurl: string;
	registerurl: string;
	constructor(
		filter: AccountSwitcher["filter"] = () => true,
		{
			canCreate = true,
			createOpt = false,
			canLogOut = true,
			canHide = true,
			loginurl = "/login",
			registerurl = "/register",
			loginText = () => I18n.addAccount(),
		} = {},
	) {
		this.filter = filter;
		this.canCreate = canCreate;
		this.canLogOut = canLogOut;
		this.canHide = canHide;
		this.loginText = loginText;
		this.createOpt = createOpt;
		this.loginurl = loginurl;
		this.registerurl = registerurl;
	}
	async show(): Promise<Specialuser> {
		const table = document.createElement("div");
		table.classList.add("flexttb", "accountSwitcher");
		return new Promise<Specialuser>((res) => {
			for (const user of Object.values(Localuser.users.users)) {
				const specialUser = user as Specialuser;
				if (!this.filter(specialUser)) continue;
				const userInfo = document.createElement("div");

				userInfo.classList.add("flexltr", "switchtable");

				const pfp = createImg(specialUser.pfpsrc);
				pfp.classList.add("pfp");
				userInfo.append(pfp);

				const userDiv = document.createElement("div");
				userDiv.classList.add("userinfo");
				userDiv.textContent = specialUser.username;
				userDiv.append(document.createElement("br"));

				const span = document.createElement("span");
				span.textContent = specialUser.serverurls.wellknown
					.replace("https://", "")
					.replace("http://", "");
				span.classList.add("serverURL");
				userDiv.append(span);

				const logoutButton = document.createElement("button");
				logoutButton.type = "button";
				logoutButton.classList.add("logoutButton");
				logoutButton.textContent = I18n.logout.logout();
				logoutButton.addEventListener("click", async (e) => {
					e.stopPropagation();
					e.preventDefault();
					if (await specialUser.logout()) {
						userInfo.remove();
						if (specialUser.uid === Localuser.users.currentuser) {
							const info = getBulkInfo();
							if (Object.keys(info.users).length > 0) {
								window.location.href = "/channels/@me";
							} else {
								window.location.href = "/login";
							}
						}
					}
				});

				userInfo.append(userDiv, logoutButton);
				table.append(userInfo);
				userInfo.addEventListener("contextmenu", (e) => {
					if (this.canLogOut) {
						e.stopImmediatePropagation();
						e.preventDefault();
						console.log(e, e.clientX, e.clientY);
						menu.makemenu(e.clientX, e.clientY, specialUser, undefined, table);
					}
					return;
				});
				userInfo.addEventListener("click", (e) => {
					if (e.button === 2) {
						if (this.canLogOut) {
							e.stopImmediatePropagation();
							e.preventDefault();
							menu.makemenu(e.clientX, e.clientY, specialUser, undefined, table);
						}
						return;
					}
					res(specialUser);
					userInfo.remove();
				});
			}
			if (this.canCreate) {
				const switchAccountDiv = document.createElement("div");
				switchAccountDiv.classList.add("switchtable");
				switchAccountDiv.textContent = this.loginText();
				switchAccountDiv.addEventListener("click", () => {
					window.location.href = this.loginurl;
				});
				table.append(switchAccountDiv);
			}
			if (this.createOpt) {
				const switchAccountDiv = document.createElement("div");
				switchAccountDiv.classList.add("switchtable");
				switchAccountDiv.textContent = I18n.createAccount();
				switchAccountDiv.addEventListener("click", () => {
					window.location.href = this.registerurl;
				});
				table.append(switchAccountDiv);
			}
			if (this.canHide) {
				Contextmenu.declareMenu(table);
			}
			document.body.append(table);
		});
	}
}
