import {InstanceInfo, adduser, Specialuser} from "./utils/utils.js";
import {I18n} from "./i18n.js";
import {Dialog, Form, FormError} from "./settings.js";
import {makeRegister} from "./register.js";
import {postLoginRedirect, trimTrailingSlashes} from "./utils/netUtils";
function generateRecArea(recover = document.getElementById("recover")) {
	if (!recover) return;
	recover.innerHTML = "";
	const can = localStorage.getItem("canRecover");
	if (can) {
		const a = document.createElement("a");
		a.textContent = I18n.login.recover();
		a.href = "/reset" + window.location.search;
		recover.append(a);
	}
}
const recMap = new Map<string, Promise<boolean>>();
async function recover(e: InstanceInfo, recover = document.getElementById("recover")) {
	const prom = new Promise<boolean>(async (res) => {
		if (!recover) {
			res(false);
			return;
		}
		recover.innerHTML = "";
		try {
			if (!(await recMap.get(e.api))) {
				if (recMap.has(e.api)) {
					throw Error("can't recover");
				}
				recMap.set(e.api, prom);
				const json = (await (await fetch(e.api + "/policies/instance/config")).json()) as {
					can_recover_account: boolean;
				};
				if (!json || !json.can_recover_account) throw Error("can't recover account");
			}
			res(true);
			localStorage.setItem("canRecover", "true");
			generateRecArea(recover);
		} catch {
			res(false);
			localStorage.removeItem("canRecover");
			generateRecArea(recover);
		} finally {
			res(false);
		}
	});
}

export async function makeLogin(
	trasparentBg = false,
	instance = "",
	handle?: (user: Specialuser) => void,
) {
	const dialog = new Dialog("");
	const opt = dialog.options;
	let form: Form;
	let rec: HTMLDivElement;
	let pendingInstance: InstanceInfo | undefined;
	// The instance the form currently posts to, and per submit (keyed by the body Form hands to
	// both the preprocessor and onSubmit) the one that request went to. The session is saved
	// against its own request's instance: the picker stays editable, and Form allows a second
	// submit while the first is still out.
	let loginInstance: InstanceInfo | undefined;
	const submittedInstances = new WeakMap<object, InstanceInfo>();
	const applyInstance = (info: InstanceInfo) => {
		loginInstance = info;
		if (!form || !rec) {
			pendingInstance = info;
			return;
		}
		form.fetchURL = trimTrailingSlashes(info.api) + "/auth/login";
		recover(info, rec);
	};
	opt.addTitle(I18n.login.login());
	opt.addHTMLArea(() => {
		const notice = document.createElement("div");
		notice.classList.add("verify");
		notice.textContent = I18n.login.explorerNotice();
		return notice;
	});
	const picker = opt.addInstancePicker(applyInstance, {
		instance,
	});
	opt.deleteElm(picker as never);
	dialog.show(trasparentBg).parentElement!.style.zIndex = "200";

	form = opt.addForm(
		"",
		(res, sent) => {
			if ("token" in res && typeof res.token == "string") {
				const submittedInstance = submittedInstances.get(sent);
				if (!submittedInstance) throw new Error("Login succeeded before any instance was applied");
				const u = adduser({
					serverurls: submittedInstance,
					email: email.value,
					token: res.token,
				});
				u.username = email.value;
				if (handle) {
					handle(u);
					dialog.hide();
					return;
				}
				window.location.href = postLoginRedirect(
					new URLSearchParams(window.location.search).get("goback"),
				);
			} else {
				// A success without a session: nothing to log in with.
				throw new FormError(password, I18n.requestFailed("no token"));
			}
		},
		{
			submitText: I18n.login.login(),
			method: "POST",
			headers: {
				"Content-type": "application/json; charset=UTF-8",
			},
			vsmaller: true,
		},
	);
	// Field errors on login/password are placed by Form itself; any other refusal lands here.
	form.onErrorBody = (res: {message?: unknown; errors?: {[key: string]: {_errors?: {message?: string}[]}}}) => {
		const fieldMessage = Object.values(res.errors ?? {})[0]?._errors?.[0]?.message;
		const message = fieldMessage ?? res.message;
		if (typeof message === "string") throw new FormError(password, message);
	};
	form.addPreprocessor((sent) => {
		// The submit must not reach an unvalidated origin: that is how a typo'd instance hung
		// the app at the loading screen (the button is gated, but Enter submitted anyway).
		if (picker.validationState !== "ok") {
			throw new FormError(
				email,
				picker.validationState === "invalid"
					? I18n.login.invalid()
					: I18n.login.checking(),
			);
		}
		if (loginInstance) submittedInstances.set(sent, loginInstance);
	});
	const button = form.button.deref();
	picker.giveButton(button);
	button?.classList.add("createAccount");
	opt.addHTMLArea(() => {
		const details = document.createElement("details");
		details.classList.add("loginAdvanced");
		const summary = document.createElement("summary");
		summary.textContent = "Advanced";
		details.append(summary, picker.generateHTML());
		return details;
	});
	opt.addHTMLArea(() => {
		const status = document.createElement("div");
		status.classList.add("verify", "loginInstanceStatus");
		const label = document.createElement("span");
		label.textContent = I18n.htmlPages.instanceField() + " ";
		status.append(label, picker.verify);
		return status;
	});

	const email = form.addTextInput(I18n.htmlPages.emailField(), "login");
	const password = form.addTextInput(I18n.htmlPages.pwField(), "password", {password: true});
	form.addCaptcha();
	const a = document.createElement("a");
	a.onclick = () => {
		dialog.hide();
		makeRegister(trasparentBg, picker.input.value, handle);
	};
	a.textContent = I18n.htmlPages.noAccount();
	rec = document.createElement("div");
	form.addHTMLArea(rec);
	form.addHTMLArea(a);
	if (pendingInstance) {
		applyInstance(pendingInstance);
		pendingInstance = undefined;
	}
}
await I18n.done;
if (window.location.pathname.startsWith("/login")) {
	makeLogin();
}
