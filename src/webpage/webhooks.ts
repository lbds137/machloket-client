import {Guild} from "./guild.js";
import {I18n} from "./i18n.js";
import {webhookType} from "./jsontypes.js";
import {MarkDown} from "./markdown.js";
import {Dialog, Options} from "./settings.js";
import {SnowFlake} from "./snowflake.js";
import {User} from "./user.js";
import {CDNParams} from "./utils/cdnParams.js";
import {refusalText, showRefusal} from "./utils/showRefusal.js";

function getWebhookApiRoot(api: string) {
	const trimmed = api.replace(/\/+$/, "");
	try {
		const url = new URL(trimmed);
		const path = url.pathname.replace(/\/+$|^\/|\/$/g, "");
		if (!path) {
			url.pathname = "/api/v9";
		} else if (/^api\/v\d+$/.test(path) || /^v\d+$/.test(path)) {
			url.pathname = "/" + path;
		} else if (/^api$/.test(path)) {
			url.pathname = "/api/v9";
		} else if (/^api\/v\d+\//.test(path) || /^v\d+\//.test(path)) {
			url.pathname = "/" + path;
		} else {
			url.pathname = "/" + path + "/api/v9";
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		return trimmed + "/api/v9";
	}
}

function normalizeWebhookUrl(hook: webhookType, api: string) {
	const root = getWebhookApiRoot(api);
	if (!hook.url) {
		return `${root}/webhooks/${hook.id}/${hook.token}`;
	}
	try {
		const url = new URL(hook.url, api);
		const path = url.pathname.replace(/\/+$/, "");
		if (/\/api(\/v\d+)?\/webhooks\/[^/]+\/[^/]+$/.test(path)) {
			url.pathname = path;
			return url.toString();
		}
		if (/\/webhooks\/[^/]+\/[^/]+$/.test(path)) {
			const rootUrl = new URL(root);
			rootUrl.pathname =
				rootUrl.pathname.replace(/\/+$/, "") + `/webhooks/${hook.id}/${hook.token}`;
			return rootUrl.toString();
		}
	} catch {}
	return `${root}/webhooks/${hook.id}/${hook.token}`;
}

async function webhookMenu(
	guild: Guild,
	hookURL: string,
	webhooks: Options,
	channelId: false | string = false,
) {
	const moveChannels = guild.channels.filter(
		(_) => _.hasPermission("MANAGE_WEBHOOKS") && _.type !== 4,
	);
	function newWebhook() {
		const nameBox = new Dialog(I18n.webhooks.EnterWebhookName());
		const options = nameBox.float.options;
		const defualts = I18n.webhooks.sillyDefaults().split("\n");
		let channel = channelId || moveChannels[0].id;
		let name = "";
		options.addTextInput(
			I18n.webhooks.name(),
			(value) => {
				name = value;
			},
			{
				initText: defualts[Math.floor(Math.random() * defualts.length)],
			},
		);
		if (!channelId) {
			const select = options.addSelect(
				I18n.webhooks.channel(),
				() => {},
				moveChannels.map((_) => _.name),
				{
					defaultIndex: 0,
				},
			);
			select.watchForChange((i: number) => {
				channel = moveChannels[i].id;
			});
		}
		// One webhook per Submit, however often it's clicked while the first is on its way.
		let sending = false;
		options.addButtonInput("", I18n.submit(), async () => {
			if (sending) return;
			sending = true;
			options.submit();
			const res = await fetch(`${guild.info.api}/channels/${channel}/webhooks/`, {
				method: "POST",
				headers: guild.headers,
				body: JSON.stringify({name}),
			}).catch(() => undefined);
			const hook = res?.ok
				? ((await res
						.clone()
						.json()
						.catch(() => null)) as webhookType | null)
				: null;
			sending = false;
			if (typeof hook?.id !== "string") return showRefusal(res);
			makeHook(hook);
			nameBox.hide();
		});
		nameBox.show();
	}
	async function regenArea() {
		webhooks.removeAll();

		// Without a channel to put one in there's no webhook to make.
		if (channelId || moveChannels.length) {
			webhooks.addButtonInput("", I18n.webhooks.newWebHook(), newWebhook);
		}
		const res = await fetch(hookURL, {headers: guild.headers}).catch(() => undefined);
		const hooks = res?.ok
			? ((await res
					.clone()
					.json()
					.catch(() => null)) as unknown)
			: null;
		if (!Array.isArray(hooks)) {
			webhooks.addText(await refusalText(res));
			return;
		}
		for (const hook of hooks) {
			makeHook(hook);
		}
	}

	const makeHook = (hook: webhookType) => {
		//TODO remove once the server fixes this bug
		hook.url = normalizeWebhookUrl(hook, guild.info.api);

		const div = document.createElement("div");
		div.classList.add("flexltr", "webhookArea");
		const pfp = document.createElement("img");
		if (hook.avatar) {
			pfp.src =
				`${guild.info.cdn}/avatars/${hook.id}/${hook.avatar}` + new CDNParams({expectedSize: 96});
		} else {
			const int = Number((BigInt(hook.id) >> 22n) % 6n);
			pfp.src = `${guild.info.cdn}/embed/avatars/${int}.png`;
		}
		pfp.classList.add("webhookpfppreview");

		const namePlate = document.createElement("div");
		namePlate.classList.add("flexttb");

		const name = document.createElement("b");
		name.textContent = hook.name;

		const createdAt = document.createElement("span");
		createdAt.textContent = I18n.webhooks.createdAt(
			new Intl.DateTimeFormat(I18n.locale).format(SnowFlake.stringToUnixTime(hook.id)),
		);

		const wtype = document.createElement("span");
		let typeText: string;
		switch (hook.type) {
			case 1:
				typeText = I18n.webhooks.type1();
				break;
			case 2:
				typeText = I18n.webhooks.type2();
				break;
			case 3:
				typeText = I18n.webhooks.type3();
				break;
		}
		wtype.textContent = I18n.webhooks.type(typeText);

		namePlate.append(name, createdAt, wtype);

		const icon = document.createElement("span");
		icon.classList.add("svg-intoMenu", "svgicon");

		div.append(pfp, namePlate, icon);

		div.onclick = () => {
			const form = webhooks.addSubForm(
				hook.name,
				() => {
					regenArea();
				},
				{
					traditionalSubmit: true,
					method: "PATCH",
					fetchURL: guild.info.api + "/webhooks/" + hook.id,
					headers: guild.headers,
				},
			);
			form.addTextInput(I18n.webhooks.name(), "name", {initText: hook.name});
			form.addFileInput(I18n.webhooks.avatar(), "avatar", {clear: true});

			form.addSelect(
				I18n.webhooks.channel(),
				"channel_id",
				moveChannels.map((_) => _.name),
				{
					defaultIndex: moveChannels.findIndex((_) => _.id === hook.channel_id),
				},
				moveChannels.map((_) => _.id),
			);

			form.addMDText(new MarkDown(I18n.webhooks.token(hook.token), undefined));
			form.addMDText(new MarkDown(I18n.webhooks.url(hook.url), undefined));
			form.addText(I18n.webhooks.type(typeText));
			form.addButtonInput("", I18n.webhooks.copyURL(), () => {
				navigator.clipboard.writeText(hook.url);
			});

			form.addText(I18n.webhooks.createdBy());

			try {
				const user = new User(hook.user, guild.localuser);
				const div = user.createWidget(guild);
				form.addHTMLArea(div);
			} catch {}
			form.addButtonInput("", I18n.webhooks.deleteWebhook(), () => {
				const d = new Dialog("areYouSureDelete");
				const opt = d.options;
				opt.addTitle(I18n.webhooks.areYouSureDelete(hook.name));
				const opt2 = opt.addOptions("", {ltr: true});
				opt2.addButtonInput("", I18n.yes(), async () => {
					const res = await fetch(guild.info.api + "/webhooks/" + hook.id, {
						method: "DELETE",
						headers: guild.headers,
					}).catch(() => undefined);
					if (!res?.ok) return showRefusal(res);
					d.hide();
					regenArea();
				});
				opt2.addButtonInput("", I18n.no(), () => {
					d.hide();
				});
				d.show();
			});
		};
		webhooks.addHTMLArea(div);
	};
	regenArea();
}
export {webhookMenu};
