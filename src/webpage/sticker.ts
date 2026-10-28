import {Contextmenu} from "./contextmenu.js";
import {Guild} from "./guild.js";
import {Hover} from "./hover.js";
import {I18n} from "./i18n.js";
import {stickerJson} from "./jsontypes.js";
import {Localuser} from "./localuser.js";
import {SnowFlake} from "./snowflake.js";
import {CDNParams} from "./utils/cdnParams.js";
import {createImg} from "./utils/utils.js";

class Sticker extends SnowFlake {
	name: string;
	type: number;
	format_type: number;
	owner: Guild | Localuser;
	description: string;
	tags: string;
	get guild() {
		return this.owner;
	}
	get localuser() {
		if (this.owner instanceof Localuser) {
			return this.owner;
		}
		return this.owner.localuser;
	}
	constructor(json: stickerJson, owner: Guild | Localuser) {
		super(json.id);
		this.name = json.name;
		this.type = json.type;
		this.format_type = json.format_type;
		this.owner = owner;
		this.tags = json.tags;
		this.description = json.description || "";
	}
	getHTML(): HTMLElement {
		const img = createImg(
			this.owner.info.cdn + "/stickers/" + this.id + ".webp" + new CDNParams({expectedSize: 160}),
		);
		img.classList.add("sticker");
		const hover = new Hover(this.name);
		hover.addEvent(img);
		img.alt = this.description;
		return img;
	}
	static searchStickers(search: string, localuser: Localuser, results = 50): [Sticker, number][] {
		//NOTE this function is used for searching in the emoji picker for reactions, and the emoji auto-fill
		const ranked: [Sticker, number][] = [];
		function similar(json: Sticker) {
			if (json.name.includes(search)) {
				ranked.push([json, search.length / json.name.length]);
				return true;
			} else if (json.name.toLowerCase().includes(search.toLowerCase())) {
				ranked.push([json, search.length / json.name.length / 1.4]);
				return true;
			} else {
				return false;
			}
		}
		const weakGuild = new WeakMap<Sticker, Guild>();
		for (const guild of localuser.guilds) {
			if (guild.id !== "@me" && guild.stickers.length !== 0) {
				for (const sticker of guild.stickers) {
					if (similar(sticker)) {
						weakGuild.set(sticker, guild);
					}
				}
			}
		}
		ranked.sort((a, b) => b[1] - a[1]);
		return ranked.splice(0, results).map((a) => {
			return a;
		});
	}
	static getFromId(id: string, localuser: Localuser) {
		for (const guild of localuser.guilds) {
			// The @me home (Direct) extends Guild without ever assigning stickers — every
			// sticker send died here on it before the request left (undefined.find).
			const stick = (guild.stickers ?? []).find((_) => _.id === id);
			if (stick) {
				return stick;
			}
		}
		return undefined;
	}
	static async stickerPicker(
		x: number,
		y: number,
		localuser: Localuser,
	): Promise<Sticker | undefined> {
		let res!: (r: Sticker | undefined) => void;
		const promise = new Promise<Sticker | undefined>((r) => {
			res = r;
		});
		const menu = document.createElement("div");
		let settled = false;
		const closeObserver = new MutationObserver(() => {
			if (!menu.isConnected || menu.classList.contains("removeElm")) {
				settle(undefined);
			}
		});
		const settle = (sticker: Sticker | undefined) => {
			if (settled) return;
			settled = true;
			closeObserver.disconnect();
			res(sticker);
		};
		const watchClose = () => {
			closeObserver.observe(document.body, {childList: true});
			closeObserver.observe(menu, {attributes: true, attributeFilter: ["class"]});
		};
		menu.classList.add("flexttb", "stickerPicker");
		if (y > 0) {
			menu.style.top = y + "px";
		} else {
			menu.style.bottom = y * -1 + "px";
		}
		if (x > 0) {
			menu.style.left = x + "px";
		} else {
			menu.style.right = x * -1 + "px";
		}

		const topBar = document.createElement("div");
		topBar.classList.add("flexltr", "emojiHeading");
		const guilds = [
			localuser.lookingguild,
			...localuser.guilds.filter((guild) => guild !== localuser.lookingguild),
		]
			.filter((guild) => guild !== undefined)
			.filter((guild) => guild.id != "@me" && guild.stickers.length > 0);
		if (guilds.length === 0) {
			const title = document.createElement("h2");
			title.textContent = I18n.noStickers();
			topBar.append(title);
			menu.append(topBar);
			Contextmenu.declareMenu(menu);
			document.body.append(menu);
			Contextmenu.keepOnScreen(menu);
			watchClose();
			return promise;
		}
		const title = document.createElement("h2");
		title.textContent = guilds[0].properties.name;
		title.classList.add("emojiTitle");
		topBar.append(title);

		const search = document.createElement("input");
		search.type = "text";
		search.placeholder = I18n.search.search();
		topBar.append(search);

		let html: HTMLElement | undefined = undefined;
		let topSticker: undefined | Sticker = undefined;
		const resetSearch = () => {
			search.style.removeProperty("width");
			topSticker = undefined;
		};
		const updateSearch = () => {
			if (search.value === "") {
				if (html) html.click();
				resetSearch();
				return;
			}

			search.style.setProperty("width", "3in");
			title.innerText = "";
			body.innerHTML = "";
			const searchResults = Sticker.searchStickers(search.value, localuser, 200);
			if (searchResults[0]) {
				topSticker = searchResults[0][0];
			}
			for (const [sticker] of searchResults) {
				const emojiElem = document.createElement("div");
				emojiElem.classList.add("stickerSelect");

				emojiElem.append(sticker.getHTML());
				body.append(emojiElem);

				emojiElem.addEventListener("click", () => {
					settle(sticker);
					Contextmenu.declareMenu();
				});
			}
		};
		search.addEventListener("input", () => {
			updateSearch.call(this);
		});
		search.addEventListener("keyup", (e) => {
			if (e.key === "Enter" && topSticker) {
				settle(topSticker);
				Contextmenu.declareMenu();
			}
		});

		menu.append(topBar);

		const selection = document.createElement("div");
		selection.classList.add("flexltr", "emojirow");
		const body = document.createElement("div");
		body.classList.add("stickerBody");

		// TUNABLE: maximum number of stickers shown in the Frequently Used section.
		const FREQUENT_STICKERS_CAP = 10;
		const stickerById = new Map<string, Sticker>();
		for (const guild of guilds) {
			for (const sticker of guild.stickers) {
				stickerById.set(sticker.id, sticker);
			}
		}
		const frequentStickers: Sticker[] = [];
		for (const [id] of localuser.favorites?.stickersFreq() ?? []) {
			if (frequentStickers.length >= FREQUENT_STICKERS_CAP) break;
			const sticker = stickerById.get(id);
			if (sticker) {
				frequentStickers.push(sticker);
			}
		}

		let isFirst = true;
		let i = 0;
		if (frequentStickers.length > 0) {
			const select = document.createElement("div");
			select.classList.add("svg-history");
			html = select;
			i++;
			selection.append(select);
			const clickFrequent = () => {
				search.value = "";
				resetSearch();
				title.textContent = I18n.sticker.frequentlyUsed();
				body.innerHTML = "";
				for (const sticker of frequentStickers) {
					const stickerElem = document.createElement("div");
					stickerElem.classList.add("stickerSelect");
					stickerElem.append(sticker.getHTML());
					body.append(stickerElem);
					stickerElem.addEventListener("click", () => {
						settle(sticker);
						Contextmenu.declareMenu();
					});
				}
			};
			select.addEventListener("click", clickFrequent);
			if (isFirst) {
				clickFrequent();
				isFirst = false;
			}
		}
		guilds.forEach((guild) => {
			const select = document.createElement("div");
			if (i === 0) {
				html = select;
				i++;
			}
			select.classList.add("emojiSelect");

			if (guild.properties.icon) {
				const img = document.createElement("img");
				img.classList.add("servericon", "emoji-server");
				img.crossOrigin = "anonymous";
				img.src =
					localuser.info.cdn +
					"/icons/" +
					guild.properties.id +
					"/" +
					guild.properties.icon +
					".png" +
					new CDNParams({expectedSize: 48});
				img.alt = I18n.guild.iconAlt(guild.properties.name);
				select.appendChild(img);
			} else {
				const div = document.createElement("span");
				div.textContent = guild.properties.name
					.replace(/'s /g, " ")
					.replace(/\w+/g, (word) => word[0])
					.replace(/\s/g, "");
				select.append(div);
			}

			selection.append(select);

			const clickEvent = () => {
				search.value = "";
				resetSearch();
				title.textContent = guild.properties.name;
				body.innerHTML = "";
				for (const sticker of guild.stickers) {
					const stickerElem = document.createElement("div");
					stickerElem.classList.add("stickerSelect");
					stickerElem.append(sticker.getHTML());
					body.append(stickerElem);
					stickerElem.addEventListener("click", () => {
						settle(sticker);
						Contextmenu.declareMenu();
					});
				}
			};

			select.addEventListener("click", clickEvent);
			if (isFirst) {
				clickEvent();
				isFirst = false;
			}
		});

		Contextmenu.declareMenu(menu);
		document.body.append(menu);
		Contextmenu.keepOnScreen(menu);
		menu.append(selection);
		menu.append(body);
		watchClose();
		search.focus();
		return promise;
	}
}
export {Sticker};
