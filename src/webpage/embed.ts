import {Message} from "./message.js";
import {MarkDown} from "./markdown.js";
import {embedjson, invitejson} from "./jsontypes.js";
import {createImg, getapiurls, getBulkUsers, getInstances, Specialuser} from "./utils/utils.js";
import {Guild} from "./guild.js";
import {I18n} from "./i18n.js";
import {ImagesDisplay} from "./disimg.js";
import {File} from "./file.js";
import {CDNParams} from "./utils/cdnParams.js";
import {acceptInvite} from "./utils/acceptInvite.js";

/** The hosts that serve YouTube's embeddable player. */
const YOUTUBE_PLAYER_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
]);

/** The player iframe's src for a video embed, or null when the url isn't YouTube's player. */
export function youtubeEmbedSrc(videoUrl: string): string | null {
	if (!URL.canParse(videoUrl)) return null;
	const url = new URL(videoUrl);
	// The scheme check is the point: javascript://youtube.com/… parses with host youtube.com.
	if (url.protocol !== "https:" || !YOUTUBE_PLAYER_HOSTS.has(url.host)) return null;
	if (!url.pathname.startsWith("/embed/") || url.username || url.password) return null;
	url.searchParams.set("autoplay", "1");
	return url.href;
}

class Embed {
	type: string;
	owner: Message;
	json: embedjson;
	constructor(json: embedjson, owner: Message) {
		this.type = this.getType(json);
		this.owner = owner;
		this.json = json;
	}
	getType(json: embedjson) {
		const users = Object.values(getBulkUsers().users) as Specialuser[];
		const instances = getInstances()
			?.map((_) => _.url)
			.filter((_) => undefined !== _)
			.concat(users.map((_) => _.serverurls.wellknown));
		if (instances && json.type === "link" && json.url && URL.canParse(json.url)) {
			const Url = new URL(json.url);
			for (const instance of instances) {
				if (instance && URL.canParse(instance)) {
					const IUrl = new URL(instance);
					const params = new URLSearchParams(Url.search);
					let host: string;
					if (params.has("instance")) {
						const url = params.get("instance") as string;
						if (URL.canParse(url)) {
							host = new URL(url).host;
						} else {
							host = Url.host;
						}
					} else {
						host = Url.host;
					}
					if (IUrl.host === host) {
						const code = Url.pathname.split("/")[Url.pathname.split("/").length - 1];
						json.invite = {
							url: instance,
							code,
						};
						return "invite";
					}
				}
			}
		}
		return json.type || "rich";
	}
	generateHTML() {
		switch (this.type) {
			case "rich":
				return this.generateRich();
			case "image":
				return this.generateImage();
			case "invite":
				return this.generateInvite();
			case "link":
				return this.generateLink();
			case "video":
			case "article":
				return this.generateArticle();
			default:
				console.warn(`unsupported embed type ${this.type}, please add support dev :3`, this.json);
				return document.createElement("div"); //prevent errors by giving blank div
		}
	}
	get message() {
		return this.owner;
	}
	get channel() {
		return this.message.channel;
	}
	get guild() {
		return this.channel.guild;
	}
	get localuser() {
		return this.guild.localuser;
	}
	generateRich() {
		const div = document.createElement("div");
		div.style.backgroundColor =
			this.json.color !== undefined
				? "#" + this.json.color.toString(16).padStart(6, "0")
				: "var(--embed-bg-side)";

		div.classList.add("embed-color", "rich-embed");

		const embed = document.createElement("div");
		embed.classList.add("embed");
		div.append(embed);

		// Discord's small image at the top right, the text flowing beside it.
		const thumbnail = this.json.thumbnail;
		if (thumbnail?.url || thumbnail?.proxy_url) {
			const img = document.createElement("img");
			img.classList.add("embedThumbnail");
			const proxied = Boolean(thumbnail.proxy_url);
			this.localuser.refreshIfNeeded(thumbnail.proxy_url || thumbnail.url).then((url) => {
				thumbnail[proxied ? "proxy_url" : "url"] = url;
				img.src = url;
			});
			embed.append(img);
		}
		if (this.json.provider?.name) {
			const provider = document.createElement("p");
			provider.classList.add("provider");
			provider.textContent = this.json.provider.name;
			embed.append(provider);
		}

		if (this.json.author) {
			const authorline = document.createElement("div");
			if (this.json.author.icon_url) {
				const img = document.createElement("img");
				img.classList.add("authorEmbedImg");
				// The instance's proxy copy, when the server made one, keeps viewers off the bot's host.
				const proxied = Boolean(this.json.author.proxy_icon_url);
				const src = this.json.author.proxy_icon_url || this.json.author.icon_url;
				this.localuser.refreshIfNeeded(src).then((url) => {
					if (this.json.author) this.json.author[proxied ? "proxy_icon_url" : "icon_url"] = url;
					img.src = url;
				});
				authorline.append(img);
			}
			const a = this.json.author.url ? document.createElement("a") : document.createElement("span");
			a.textContent = this.json.author.name as string;
			if (this.json.author.url) {
				MarkDown.safeLink(a, this.json.author.url);
				a.classList.add("username");
			}

			authorline.append(a);
			embed.append(authorline);
		}
		if (this.json.title) {
			const title = document.createElement("a");
			title.append(new MarkDown(this.json.title, this.channel).makeHTML());
			if (this.json.url) {
				MarkDown.safeLink(title, this.json.url);
			}
			title.classList.add("embedtitle");
			embed.append(title);
		}
		if (this.json.description) {
			const p = document.createElement("p");
			p.append(new MarkDown(this.json.description, this.channel).makeHTML());
			embed.append(p);
		}

		if (this.json.fields) {
			// Discord's layout: consecutive inline fields share a row, up to three (two beside a
			// thumbnail), splitting its 12 columns; any other field takes a row of its own.
			const fields = document.createElement("div");
			fields.classList.add("embedFields");
			const maxRow = thumbnail?.url || thumbnail?.proxy_url ? 2 : 3;
			let row: HTMLDivElement[] = [];
			const flushRow = () => {
				for (const item of row) {
					item.style.gridColumn = `span ${12 / row.length}`;
				}
				row = [];
			};
			for (const thing of this.json.fields) {
				const div = document.createElement("div");
				const b = document.createElement("b");
				b.textContent = thing.name;
				div.append(b);
				const p = document.createElement("p");
				p.append(new MarkDown(thing.value, this.channel).makeHTML());
				p.classList.add("embedp");
				div.append(p);

				if (thing.inline) {
					div.classList.add("inline");
					row.push(div);
					if (row.length === maxRow) flushRow();
				} else {
					flushRow();
					div.style.gridColumn = "span 12";
				}
				fields.append(div);
			}
			flushRow();
			embed.append(fields);
		}
		if (this.json.image) {
			const img = document.createElement("img");
			img.classList.add("embedImg");
			if (this.json.image.width) {
				img.width = this.json.image.width;
			}
			if (this.json.image.height) {
				img.height = this.json.image.height;
			}
			const proxied = Boolean(this.json.image.proxy_url);
			const src = this.json.image.proxy_url || this.json.image.url;
			this.localuser.refreshIfNeeded(src).then((url) => {
				if (this.json.image) this.json.image[proxied ? "proxy_url" : "url"] = url;
				img.src = url;
			});
			embed.append(img);
		}
		if (this.json.footer || this.json.timestamp) {
			const footer = document.createElement("div");
			if (this.json?.footer?.icon_url) {
				const img = document.createElement("img");
				const proxied = Boolean(this.json.footer.proxy_icon_url);
				const src = this.json.footer.proxy_icon_url || this.json.footer.icon_url;
				this.localuser.refreshIfNeeded(src).then((url) => {
					if (this.json.footer) this.json.footer[proxied ? "proxy_icon_url" : "icon_url"] = url;
					img.src = url;
				});
				img.classList.add("embedicon");
				footer.append(img);
			}
			if (this.json?.footer?.text) {
				const span = document.createElement("span");
				span.textContent = this.json.footer.text;
				footer.append(span);
			}
			if (this.json?.footer && this.json?.timestamp) {
				const span = document.createElement("span");
				span.textContent = " • ";
				footer.append(span);
			}
			if (this.json?.timestamp) {
				const span = document.createElement("span");
				span.textContent = new Date(this.json.timestamp).toLocaleString(I18n.locale);
				footer.append(span);
			}
			embed.append(footer);
		}
		return div;
	}
	generateImage() {
		const div = document.createElement("div");
		div.classList.add("messageimgdiv");
		// Link previews carry the picture as `thumbnail`; the server's own image embeds as `image`.
		const pic = this.json.thumbnail ?? this.json.image;
		if (!pic) return div;
		const src = pic.proxy_url ?? pic.url;
		const img = createImg(src);
		img.classList.add("messageimg");
		img.style.height = "auto";
		img.onclick = () => {
			const full = new ImagesDisplay([
				new File(
					{
						id: "",
						filename: "",
						url: src,
						size: -1,
						content_type: "image/",
					},
					null,
				),
			]);
			full.show();
		};
		let thumbW = pic.width;
		let thumbH = pic.height;
		// An `image` may come without its size: then the picture keeps its own.
		if (thumbW && thumbH) {
			let scale = 1;
			const max = 96 * 3;
			scale = Math.max(scale, thumbW / max);
			scale = Math.max(scale, thumbH / max);
			thumbW /= scale;
			thumbH /= scale;
			img.style.width = thumbW + "px";
		}
		img.isAnimated().then((animated) => {
			// A favourite GIF is kept with its size: without one there's no star to offer.
			if (!animated || !this.owner || !pic.width || !pic.height) return;
			const url = new URL(pic.url).origin + new URL(pic.url).pathname;
			const span = document.createElement("span");
			span.classList.add("svg-gifstar");
			if (this.owner.localuser.favorites.hasGif(url)) {
				span.classList.add("favorited");
			}
			div.append(span);

			span.onclick = () => {
				if (!this.owner) return;
				const fav = this.owner.localuser.favorites;

				if (fav.hasGif(url)) {
					span.classList.remove("favorited");
					fav.unfavoriteGif(url);
				} else {
					span.classList.add("favorited");
					fav.favoriteGif(url, {
						src: url,
						width: pic.width,
						height: pic.height,
					});
				}
			};
		});
		div.append(img);
		return div;
	}
	generateLink() {
		const table = document.createElement("table");
		table.classList.add("embed", "linkembed");
		const trtop = document.createElement("tr");
		table.append(trtop);
		if (this.json.url && this.json.title) {
			const td = document.createElement("td");
			const a = document.createElement("a");
			MarkDown.safeLink(a, this.json.url);
			a.textContent = this.json.title;
			a.classList.add("embedtitle");
			td.append(a);
			trtop.append(td);
		}
		{
			const td = document.createElement("td");
			const img = document.createElement("img");
			if (this.json.thumbnail) {
				img.classList.add("embedimg");
				img.onclick = function () {
					const full = new ImagesDisplay([
						new File({id: "", filename: "", url: img.src, size: -1, content_type: "image/"}, null),
					]);
					full.show();
				};
				img.src = this.json.thumbnail.proxy_url;
				td.append(img);
			}
			trtop.append(td);
		}
		const bottomtr = document.createElement("tr");
		const td = document.createElement("td");
		if (this.json.description) {
			const span = document.createElement("span");
			span.textContent = this.json.description;
			td.append(span);
		}
		bottomtr.append(td);
		table.append(bottomtr);
		return table;
	}
	invcache: [invitejson, {cdn: string; api: string}] | undefined;
	generateInvite() {
		if (this.invcache && (!this.json.invite || !this.localuser)) {
			return this.generateLink();
		}
		const div = document.createElement("div");
		div.classList.add("embed", "inviteEmbed", "flexttb");
		const json1 = this.json.invite;
		const load = async () => {
			let json: invitejson;
			let info: {cdn: string; api: string};
			if (!this.invcache) {
				if (!json1) {
					div.classList.remove("embed", "inviteEmbed", "flexttb");
					div.append(this.generateLink());
					return;
				}
				const tempinfo = await getapiurls(json1.url);

				if (!tempinfo) {
					div.classList.remove("embed", "inviteEmbed", "flexttb");
					div.append(this.generateLink());
					return;
				}
				info = tempinfo;
				const res = await fetch(info.api + "/invites/" + json1.code).catch(() => undefined);
				// Whatever stops the preview (a refusal, no answer, a page that isn't the invite's
				// JSON) gives way to the plain link, as a refused invite always has.
				const loaded = res?.ok
					? ((await res.json().catch(() => null)) as invitejson | null)
					: null;
				if (!loaded?.guild || !loaded.channel) {
					div.classList.remove("embed", "inviteEmbed", "flexttb");
					div.append(this.generateLink());
					return;
				}
				json = loaded;
				this.invcache = [json, info];
			} else {
				[json, info] = this.invcache;
			}
			if (!json) {
				div.append(this.generateLink());
				div.classList.remove("embed", "inviteEmbed", "flexttb");
				return;
			}
			if (json.guild.banner) {
				const banner = document.createElement("img");
				banner.src =
					info.cdn +
					"/banners/" +
					json.guild.id +
					"/" +
					json.guild.banner +
					".png" +
					new CDNParams({expectedSize: 256});
				banner.classList.add("banner");
				div.append(banner);
			}
			const guild: invitejson["guild"] & {info?: {cdn: string}} = json.guild;
			guild.info = info;
			const icon = Guild.generateGuildIcon(guild as invitejson["guild"] & {info: {cdn: string}});
			const iconrow = document.createElement("div");
			iconrow.classList.add("flexltr");
			iconrow.append(icon);
			{
				const guildinfo = document.createElement("div");
				guildinfo.classList.add("flexttb", "invguildinfo");
				const name = document.createElement("b");
				name.textContent = guild.name;
				guildinfo.append(name);

				const members = document.createElement("span");
				const count = guild.member_count?.toLocaleString(I18n.locale);
				members.innerText =
					"#" + json.channel.name + (count !== undefined ? " • " + I18n.invite.members(count) : "");
				guildinfo.append(members);
				members.classList.add("subtext");
				iconrow.append(guildinfo);
			}

			div.append(iconrow);
			const h2 = document.createElement("h2");
			h2.textContent = json.inviter
				? I18n.invite.invitedBy(json.inviter.username)
				: I18n.invite.invitedTo(guild.name);
			div.append(h2);
			const button = document.createElement("button");
			button.textContent = I18n.invite.accept();
			if (this.localuser.info.api.startsWith(info.api) && this.localuser.guildids.has(guild.id)) {
				button.textContent = I18n.invite.alreadyJoined();
				button.disabled = true;
			}
			button.classList.add("acceptinvbutton");
			div.append(button);
			button.onclick = (_) => {
				if (this.localuser.info.api.startsWith(info.api)) {
					acceptInvite(
						this.localuser.info.api,
						json.code,
						this.localuser.headers.Authorization,
					).then((result) => {
						// The accept and the already-member refusal both land in the guild; a real refusal alerts.
						if (result.ok) {
							if (result.alreadyMember) this.localuser.loadGuild(guild.id);
							else this.localuser.openJoinedGuild(guild.id);
						} else {
							alert(result.message);
						}
					});
				} else {
					if (this.json.invite) {
						const params = new URLSearchParams("");
						params.set("instance", this.json.invite.url);
						const encoded = params.toString();
						const url = `${location.origin}/invite/${this.json.invite.code}?${encoded}`;
						window.open(url, "_blank");
					}
				}
			};
		};
		// A preview fetches from the instance the link names (one of the instance list's or a
		// logged-in account's, picked by the sender), so every viewer would contact that third
		// party as the message renders. Invites to this account's own instance load straight
		// away; any other waits for a tap.
		if (json1 && !this.invcache && !this.isOwnInstance(json1.url)) {
			const host = URL.canParse(json1.url) ? new URL(json1.url).host : json1.url;
			const label = document.createElement("span");
			label.textContent = I18n.invite.otherInstance(host);
			const show = document.createElement("button");
			show.textContent = I18n.invite.showPreview();
			show.classList.add("acceptinvbutton");
			show.onclick = () => {
				show.disabled = true;
				load().then(() => {
					label.remove();
					show.remove();
				});
			};
			div.append(label, show);
		} else {
			load();
		}
		return div;
	}
	private isOwnInstance(url: string) {
		const own = this.localuser?.info?.wellknown;
		return URL.canParse(url) && !!own && URL.canParse(own) && new URL(url).origin === new URL(own).origin;
	}
	generateArticle() {
		const colordiv = document.createElement("div");
		colordiv.style.backgroundColor = "#000000";
		colordiv.classList.add("embed-color");

		const div = document.createElement("div");
		div.classList.add("embed");
		if (this.json.provider) {
			const provider = document.createElement("p");
			provider.classList.add("provider");
			provider.textContent = this.json.provider.name;
			div.append(provider);
		}
		const a = document.createElement("a");
		if (this.json.url && this.json.url) {
			MarkDown.safeLink(a, this.json.url);
			a.textContent = this.json.title || this.json.url;
			a.classList.add("embedtitle");
			div.append(a);
		}
		if (this.json.description) {
			const description = document.createElement("p");
			description.textContent = this.json.description;
			div.append(description);
		}
		if (this.json.thumbnail) {
			const img = document.createElement("img");
			let thumbW = this.json.thumbnail.width;
			let thumbH = this.json.thumbnail.height;
			if (thumbW) {
				let scale = 1;
				const inch = 96;
				scale = Math.max(scale, thumbW / inch / 4);
				scale = Math.max(scale, thumbH / inch / 3);
				thumbW /= scale;
				thumbH /= scale;
				img.style.width = thumbW + "px";
			}
			img.classList.add("bigembedimg");
			if (this.json.video) {
				img.onclick = async () => {
					if (this.json.video) {
						const src = youtubeEmbedSrc(this.json.video.url);
						if (!src) return;
						img.remove();
						const iframe = document.createElement("iframe");
						iframe.src = src;
						iframe.allowFullscreen = true;
						// A cross-origin frame may autoplay only when allowed to.
						iframe.allow = "autoplay; encrypted-media; picture-in-picture";
						iframe.referrerPolicy = "strict-origin-when-cross-origin";
						if (this.json.thumbnail.width && this.json.thumbnail.height) {
							iframe.style.width = this.json.thumbnail.width + "px";
							iframe.style.height = this.json.thumbnail.height + "px";
						}
						div.append(iframe);
					}
				};
			} else {
				img.onclick = async () => {
					const full = new ImagesDisplay([
						new File({id: "", filename: "", url: img.src, size: -1, content_type: "image/"}, null),
					]);
					full.show();
				};
			}
			img.src = this.json.thumbnail.proxy_url || this.json.thumbnail.url;
			div.append(img);
		}
		colordiv.append(div);
		return colordiv;
	}
}
export {Embed};
