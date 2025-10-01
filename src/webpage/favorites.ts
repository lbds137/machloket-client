import {favandfreq, freq} from "./jsontypes.js";
import {Localuser} from "./localuser.js";
const enum saveImportance {
	no = 0,
	verylow = 1,
	low = 2,
	medium = 3,
	high = 4,
}
interface permStore {
	current: {
		gifs: favandfreq["favoriteGifs"]["gifs"];
		emojiFrecency: favandfreq["emojiFrecency"]["emojis"];
		emojiReactionFrecency: favandfreq["emojiReactionFrecency"]["emojis"];
		guildAndChannelFrecency: favandfreq["guildAndChannelFrecency"]["guildAndChannels"];
	};
	needsSave: saveImportance;
	lastSave: number;
	lastDecay: number;
	old: favandfreq;
}
type RecursivePartial<T> = {
	[P in keyof T]?: T[P] extends (infer U)[]
		? RecursivePartial<U>[]
		: T[P] extends object | undefined
			? RecursivePartial<T[P]>
			: T[P];
};
export class Favorites {
	owner: Localuser;
	// ----- stuff that needs to store ----
	private gifs: favandfreq["favoriteGifs"]["gifs"] = {};
	private emojiFrecency: favandfreq["emojiFrecency"]["emojis"] = {};
	private emojiReactionFrecency: favandfreq["emojiReactionFrecency"]["emojis"] = {};
	private guildAndChannelFrecency: favandfreq["guildAndChannelFrecency"]["guildAndChannels"] = {};
	needsSave: saveImportance = 0;
	lastSave = 0;
	lastDecay = 0;
	old!: favandfreq;
	// ----- end of stuff that needs to store ----
	get info() {
		return this.owner.info;
	}
	get headers() {
		return this.owner.headers;
	}
	constructor(owner: Localuser) {
		this.owner = owner;
		this.setup();
	}
	get store() {
		return (this.owner.perminfo.favoriteStore || {}) as permStore;
	}
	loadFromLocal() {
		const store: RecursivePartial<permStore> = this.store;
		store.current ||= {};
		store.current.gifs ||= {};
		store.current.emojiFrecency ||= {};
		store.current.emojiReactionFrecency ||= {};
		store.current.guildAndChannelFrecency ||= {};
		const old: Partial<favandfreq> = (store.old ||= {}) as Partial<favandfreq>;
		old.favoriteGifs ||= {
			gifs: {},
			hideTooltip: false,
		};
		old.emojiFrecency ||= {
			emojis: {},
		};
		old.emojiReactionFrecency ||= {
			emojis: {},
		};
		old.guildAndChannelFrecency ||= {
			guildAndChannels: {},
		};
		store.needsSave ||= 0;
		store.lastSave ||= Date.now();
		store.lastDecay ||= Date.now();

		this.needsSave = store.needsSave;
		this.lastSave = store.lastSave;
		this.lastDecay = store.lastDecay;
		function deapClone(clone: any) {
			const val = JSON.parse(JSON.stringify(clone));
			return val;
		}
		this.old = deapClone(store.old) as favandfreq;

		this.gifs = deapClone(store.current.gifs);
		this.emojiFrecency = deapClone(store.current.emojiFrecency);
		this.emojiReactionFrecency = deapClone(store.current.emojiReactionFrecency);
		this.guildAndChannelFrecency = deapClone(store.current.guildAndChannelFrecency);
	}
	saveLocal() {
		const save: permStore = {
			old: this.old,
			current: {
				emojiFrecency: this.emojiFrecency,
				gifs: this.gifs,
				emojiReactionFrecency: this.emojiReactionFrecency,
				guildAndChannelFrecency: this.guildAndChannelFrecency,
			},
			lastDecay: this.lastDecay,
			lastSave: this.lastSave,
			needsSave: this.needsSave,
		};
		this.owner.perminfo.favoriteStore = save;
	}
	async saveNetwork() {
		await this.startSync(false);
		const body: favandfreq & {versions: any} = {
			versions: {clientVersion: 10, serverVersion: 0, dataVersion: 60},
			favoriteGifs: {
				gifs: this.gifs,
				hideTooltip: false,
			},
			emojiFrecency: {
				emojis: this.emojiFrecency,
			},
			emojiReactionFrecency: {
				emojis: this.emojiReactionFrecency,
			},
			guildAndChannelFrecency: {
				guildAndChannels: this.guildAndChannelFrecency,
			},
		};
		const res = await fetch(this.info.api + "/users/@me/settings-proto/2/json", {
			method: "PATCH",
			headers: this.headers,
			body: JSON.stringify(body),
		});
		res;
	}
	async startSync(save = true) {
		const sat = fetch(this.info.api + "/users/@me/settings-proto/2/json", {
			headers: this.headers,
		});
		const res: Partial<favandfreq> = await (await sat).json();
		this.saveDifs(res, save);
	}
	async setup() {
		try {
			this.loadFromLocal();
			await this.startSync();
		} catch (e) {
			console.error(e);
		}
		console.log(this);
	}
	getOld(): favandfreq {
		return this.old;
	}
	setOld(newold: favandfreq) {
		this.old = newold;
		this.saveLocal();
		return;
	}
	mixNewOldNetwork(
		newf: {[key: string]: freq},
		old: {[key: string]: freq},
		net: {[key: string]: freq},
	) {
		const oldKeys = new Set(Object.keys(old));
		const newKeys = new Set(Object.keys(newf));
		const removedKeys = oldKeys.difference(newKeys);
		const addedKeys = newKeys.difference(oldKeys);
		for (const key of removedKeys) {
			delete net[key];
		}
		for (const key of addedKeys) {
			if (net[key]) {
				const newEmj = newf[key];
				const netEmj = net[key];
				netEmj.totalUses += newEmj.totalUses;
				netEmj.score += newEmj.score;
				netEmj.recentUses = newEmj.recentUses
					.concat(netEmj.recentUses)
					.sort((a, b) => Number(BigInt(b) - BigInt(a)))
					.splice(0, 20);
			} else {
				net[key] = newf[key];
			}
		}
		const sharedKeys = newKeys.intersection(oldKeys);
		for (const key of sharedKeys) {
			const oldEmj = old[key];
			const newEmj = newf[key];
			if (net[key]) {
				const netEmj = net[key];
				netEmj.totalUses += newEmj.totalUses - oldEmj.totalUses;
				netEmj.score += newEmj.score - oldEmj.score;

				netEmj.recentUses = newEmj.recentUses
					.concat(netEmj.recentUses)
					.sort((a, b) => Number(BigInt(b) - BigInt(a)))
					.splice(0, 20);
			} else {
				net[key] = newEmj;
			}
		}
	}
	saveDifs(diffs: Partial<favandfreq>, save = true) {
		const old = this.getOld();
		if (diffs.favoriteGifs) {
			const oldKeys = new Set(Object.keys(old.favoriteGifs.gifs));
			const newKeys = new Set(Object.keys(this.gifs));
			const removedKeys = oldKeys.difference(newKeys);
			const addedKeys = newKeys.difference(oldKeys);
			for (const key of removedKeys) {
				delete diffs.favoriteGifs.gifs[key];
			}
			for (const key of addedKeys) {
				diffs.favoriteGifs.gifs[key] = this.gifs[key];
			}
			old.favoriteGifs.gifs = this.gifs = diffs.favoriteGifs.gifs;
		}
		if (diffs.emojiFrecency) {
			this.mixNewOldNetwork(
				this.emojiFrecency,
				old.emojiFrecency.emojis,
				diffs.emojiFrecency.emojis,
			);
			old.emojiFrecency.emojis = this.emojiFrecency = diffs.emojiFrecency.emojis;
		}
		if (diffs.emojiReactionFrecency) {
			this.mixNewOldNetwork(
				this.emojiReactionFrecency,
				old.emojiReactionFrecency.emojis,
				diffs.emojiReactionFrecency.emojis,
			);
			old.emojiReactionFrecency.emojis = this.emojiReactionFrecency =
				diffs.emojiReactionFrecency.emojis;
		}
		if (diffs.guildAndChannelFrecency) {
			this.mixNewOldNetwork(
				this.guildAndChannelFrecency,
				old.guildAndChannelFrecency.guildAndChannels,
				diffs.guildAndChannelFrecency.guildAndChannels,
			);
			old.guildAndChannelFrecency.guildAndChannels = this.guildAndChannelFrecency =
				diffs.guildAndChannelFrecency.guildAndChannels;
		}

		this.setOld(old);

		this.decayScore(save);
	}
	favoriteGifs() {
		return Object.values(this.gifs).sort((a, b) => a.order - b.order);
	}
	emojiFreq() {
		return Object.values(this.emojiFrecency).sort((a, b) => b.score - a.score);
	}
	emojiReactFreq() {
		return Object.entries(this.emojiReactionFrecency).sort((a, b) => b[1].score - a[1].score);
	}
	async addEmoji(nameOrID: string) {
		console.log(this.emojiReactionFrecency === this.guildAndChannelFrecency);

		const obj = (this.emojiFrecency[nameOrID] ??= {
			totalUses: 0,
			recentUses: [],
			frecency: -1,
			score: 0,
		});
		obj.totalUses++;
		obj.recentUses.unshift(Math.floor(Date.now()) + "");
		obj.recentUses = obj.recentUses.splice(0, 20);
		obj.score += 100;
		await this.save(saveImportance.low);
	}
	async addReactEmoji(nameOrID: string) {
		const obj = (this.emojiReactionFrecency[nameOrID] ??= {
			totalUses: 0,
			recentUses: [],
			frecency: -1,
			score: 0,
		});
		obj.totalUses++;
		obj.recentUses.unshift(Math.floor(Date.now()) + "");
		obj.recentUses = obj.recentUses.splice(0, 20);
		obj.score += 100;
		await this.save(saveImportance.low);
	}
	async addChannelGuild(ID: string) {
		const obj = (this.guildAndChannelFrecency[ID] ??= {
			totalUses: 0,
			recentUses: [],
			frecency: -1,
			score: 0,
		});
		obj.totalUses++;
		obj.recentUses.unshift(Math.floor(Date.now()) + "");
		obj.recentUses = obj.recentUses.splice(0, 5);
		obj.score += 100;
		await this.save(saveImportance.low);
	}
	async favoriteGif(name: string, gif: favandfreq["favoriteGifs"]["gifs"][""]) {
		this.gifs[name] = gif;
		await this.save(saveImportance.high);
	}
	async removeFavoriteGif(name: string) {
		delete this.gifs[name];
		await this.save(saveImportance.high);
	}

	async decayScore(save = true) {
		const delta = (Date.now() - this.lastDecay) / 1000 / 60 / 60 / 12;
		if (delta < 1) {
			//Don't decay scores if less than 12 hours since last decay
			return;
		}
		// Did some math and I found I liked these values for g and n
		// f\left(x\right)=\left(\frac{x}{g}+1\right)^{-n}
		const decay = (delta / 20 + 1) ** -0.35;
		Object.values(this.emojiFrecency).forEach((emoji) => {
			emoji.score *= decay;
			emoji.score ^= 0;
		});
		Object.values(this.emojiReactionFrecency).forEach((emoji) => {
			emoji.score *= decay;
			emoji.score ^= 0;
		});
		Object.values(this.guildAndChannelFrecency).forEach((thing) => {
			thing.score *= decay;
			thing.score ^= 0;
		});
		if (save) await this.save(saveImportance.low);
	}

	async save(importance: saveImportance) {
		this.saveLocal();
		let time = 0;
		this.needsSave = Math.max(this.needsSave, importance);
		switch (this.needsSave) {
			case saveImportance.no:
			case saveImportance.verylow:
				return;
			case saveImportance.low:
				time = 24 * 60 * 60 * 1000;
				break;
			case saveImportance.medium:
				time = 30 * 60 * 1000;
				break;
			case saveImportance.high:
				await this.saveNetwork();
				return;
		}
		if (this.lastSave + time < Date.now()) {
			await this.saveNetwork();
			return;
		}
	}
}
