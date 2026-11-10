import {I18n} from "../i18n.js";
import {Dialog} from "../settings.js";
import {fix} from "./cssMagic.js";
import {messageFrom, messageTo} from "./serviceType.js";
import {isLoopback, trimTrailingSlashes} from "./netUtils";
import {getLocalSettings, ServiceWorkerMode, setLocalSettings} from "./storage/localSettings";
import {getPreferences} from "./storage/userPreferences";
import {getDeveloperSettings} from "./storage/devSettings";
import {readItem, saveAccounts, writeAccounts} from "./storage/settingOverlay";
import {isStoreRefusal, trySetItem} from "./storage/trySetItem";
import {MarkDown} from "../markdown.js";

fix();
const apiDoms = new Set<string>();
let instances:
	| {
			name: string;
			description?: string;
			descriptionLong?: string;
			image?: string;
			url?: string;
			display?: boolean;
			online?: boolean;
			uptime?: {alltime: number; daytime: number; weektime: number};
			urls?: {
				wellknown: string;
				api: string;
				cdn: string;
				gateway: string;
				login?: string;
			};
	  }[]
	| null = null;
let instancesLoaded = false;
await setTheme();
export async function setTheme(theme?: string) {
	const prefs = await getPreferences();
	document.body.className = (theme || prefs.theme) + "-theme";
}
export function getBulkUsers() {
	const json = getBulkInfo();
	apiDoms.clear();
	for (const thing in json.users) {
		try {
			const user = (json.users[thing] = new Specialuser(json.users[thing]));
			apiDoms.add(new URL(user.serverurls.api).host);
		} catch {
			delete json.users[thing];
		}
	}
	if (getDeveloperSettings().interceptApiTraces) {
		SW.postMessage({
			code: "apiUrls",
			hosts: [...apiDoms],
		});
	} else {
		SW.postMessage({
			code: "apiUrls",
			hosts: undefined,
		});
	}
	return json;
}
function defaultUserInfos() {
	return {
		currentuser: null as string | null,
		users: {} as Record<string, any>,
		preferences: {
			notifications: false,
			notisound: "three",
		},
	};
}
function parseStoredAccounts(raw: string | null): {
	currentuser?: string | null;
	users: Record<string, any>;
	instances?: Record<string, any>;
	preferences?: {notifications: boolean; notisound: string};
	accent_color?: string;
} | null {
	if (!raw) return null;
	let info: unknown;
	try {
		info = JSON.parse(raw);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		return null;
	}
	if (!info || typeof info !== "object") return null;
	const users = (info as {users?: unknown}).users;
	if (!users || typeof users !== "object" || Array.isArray(users)) return null;
	return info as {users: Record<string, any>};
}
/** userinfos when it holds a usable `users` map; null when it is missing, unparseable or
 * shapeless (another tab or an extension changed the store), which is the store's state. */
export function readStoredAccounts() {
	return parseStoredAccounts(readItem("userinfos"));
}
export function getBulkInfo(): any {
	const info = readStoredAccounts();
	if (info) return info;
	console.warn("userinfos store is unreadable, reading as signed out");
	return defaultUserInfos();
}
/** JSON for a store write. A value JSON can't hold (a BigInt, a cycle) can't be stored either,
 * so its failure reads as the store's refusal (a DataCloneError), not as a bug in the caller. */
function serialiseForStore(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch (error) {
		throw new DOMException(String(error), "DataCloneError");
	}
}
/** A refused perminfo value at least this long (serialised) is dropped when the account saves
 * without it; shorter ones stay in memory. The boot path's structural writes are tens of
 * characters; the favourites blob, the unbounded writer, runs to many kilobytes. */
const PROXY_SAVE_DROP_CHARS = 4096;
/** A value that can't be serialised (a BigInt, a cycle, a function) can't be stored either:
 * it counts as too large. */
function serialisedLength(value: unknown): number {
	try {
		return JSON.stringify(value ?? null)?.length ?? Infinity;
	} catch {
		return Infinity;
	}
}
// Runs at module load on every page. It writes only when a default was missing, and a refused
// write (a full store) is logged, not thrown: a throw here stops the app booting.
export function setDefaults() {
	getPreferences().then((perfs) =>
		document.documentElement.style.setProperty("--accent-color", perfs.accentColor),
	);
	const stored = localStorage.getItem("userinfos");
	let parsed; // stays JSON.parse's any, as before
	try {
		parsed = JSON.parse(stored as string);
	} catch (error) {
		// It holds the signed-in accounts: leave it as found instead of replacing it.
		console.warn("userinfos store is malformed, leaving it as found", error);
		return;
	}
	// Anything but an object (none stored, or a stray `false`) starts over from the defaults.
	const userinfos =
		parsed !== null && typeof parsed === "object"
			? parsed
			: {
					currentuser: null,
					users: {},
					preferences: {
						notifications: false,
						notisound: "three",
					},
				};
	if (userinfos.users === undefined) {
		userinfos.users = {};
	}
	if (userinfos.accent_color === undefined) {
		userinfos.accent_color = "#3096f7";
	}
	if (userinfos.preferences === undefined) {
		userinfos.preferences = {
			notifications: false,
			notisound: "three",
		};
	}
	if (userinfos.preferences && userinfos.preferences.notisound === undefined) {
		userinfos.preferences.notisound = "three";
	}
	const next = JSON.stringify(userinfos);
	if (next !== stored) trySetItem("userinfos", next);
}
setDefaults();
export class Specialuser {
	serverurls: InstanceUrls;
	email: string;
	token: string;
	loggedin;
	json;
	constructor(json: any) {
		if (json instanceof Specialuser) {
			console.error("specialuser can't construct from another specialuser");
		}
		if (!json.serverurls) throw new Error("nope");
		this.serverurls = json.serverurls;
		let apistring = new URL(json.serverurls.api).toString();
		apistring = apistring.replace(/\/(v\d+\/?)?$/, "") + "/v9";
		this.serverurls.api = apistring;
		this.serverurls.cdn = new URL(json.serverurls.cdn).toString().replace(/\/$/, "");
		this.serverurls.gateway = new URL(json.serverurls.gateway).toString().replace(/\/$/, "");
		this.serverurls.wellknown = new URL(json.serverurls.wellknown).toString().replace(/\/$/, "");
		this.email = json.email;
		this.token = json.token;
		this.loggedin = json.loggedin;
		this.json = json;
		this.json.localuserStore ??= {};
		if (!this.serverurls || !this.email || !this.token) {
			console.error("There are fundamentally missing pieces of info missing from this user");
		}
	}
	async logout() {
		for (let i = 0; i < 3; i++) {
			try {
				const ok = (
					await fetch(this.serverurls.api + "/auth/logout", {
						method: "POST",
						headers: {Authorization: this.token},
					})
				).ok;
				if (ok) break;
			} catch {}
			if (i == 2) {
				const d = new Dialog("");
				if (
					await new Promise<boolean>((res) => {
						const buttons = d.options.addOptions(I18n.logout.error.title(), {
							ltr: true,
						});
						buttons.addText(I18n.logout.error.desc());
						buttons.addButtonInput("", I18n.logout.error.cont(), () => {
							res(false);
							d.hide();
						});
						buttons.addButtonInput("", I18n.logout.error.cancel(), () => {
							res(true);
							d.hide();
						});
						d.show();
					})
				)
					return false;
			}
		}
		this.remove();
		return true;
	}
	remove() {
		if (sessionStorage.getItem("currentuser") === this.uid) {
			sessionStorage.removeItem("currentuser");
		}
		const info = readStoredAccounts();
		if (!info) return;
		delete info.users[this.uid];
		if (info.currentuser === this.uid) {
			// `users` is keyed by uid, not an array.
			const user = Object.values(info.users)[0];
			if (user) {
				info.currentuser = new Specialuser(user).uid;
			} else {
				info.currentuser = null;
			}
		}
		saveAccounts(serialiseForStore(info));
	}
	set pfpsrc(e) {
		this.json.pfpsrc = e;
		this.tryUpdateLocal();
	}
	get pfpsrc() {
		return this.json.pfpsrc;
	}
	set username(e) {
		this.json.username = e;
		this.tryUpdateLocal();
	}
	get username() {
		return this.json.username;
	}
	set localuserStore(e) {
		this.json.localuserStore = e;
		this.tryUpdateLocal();
	}
	proxySave(e: Object) {
		return new Proxy(e, {
			set: (target, p, newValue, receiver) => {
				const had = Object.hasOwn(target, p);
				const previous = Reflect.get(target, p, receiver) as unknown;
				const bool = Reflect.set(target, p, newValue, receiver);
				if (this.tryUpdateLocal()) return bool;
				// Refused. Boot writes here (a guild's `perminfo ??= {channels: {}}`, the focused
				// channel): rolling one of those back hands the next read an undefined, so a small
				// value stays for this session; the store is full or at its edge, and the next
				// save fails with or without it. A large value that the store takes the account
				// without is what doesn't fit: drop it, or it sinks every later save.
				if (serialisedLength(newValue) < PROXY_SAVE_DROP_CHARS) return bool;
				if (had) Reflect.set(target, p, previous, receiver);
				else Reflect.deleteProperty(target, p);
				if (this.updateLocalQuietly()) return bool;
				// The store refuses even the account without it (full): keep it for this session.
				Reflect.set(target, p, newValue, receiver);
				return bool;
			},
			get: (target, p, receiver) => {
				const value = Reflect.get(target, p, receiver) as unknown;
				if (value instanceof Object) {
					return this.proxySave(value);
				}
				return value;
			},
		});
	}
	get localuserStore() {
		type jsonParse = {
			[key: string | number]: any;
		};
		return this.proxySave(this.json.localuserStore) as {
			[key: string | number]: jsonParse;
		};
	}
	/** The account's saved status as last seen, so the next connect announces it. */
	set status(e: string | undefined) {
		this.json.status = e;
		this.tryUpdateLocal();
	}
	get status(): string | undefined {
		return this.json.status;
	}
	set id(e) {
		this.json.id = e;
		this.tryUpdateLocal();
	}
	get id() {
		return this.json.id;
	}
	get uid() {
		return this.email + this.serverurls.wellknown;
	}
	toJSON() {
		return this.json;
	}
	/** Saves this account into userinfos. Throws a refused write (a full store) or a missing or unusable
	 * userinfos as a DOMException; any other error it throws is a bug. */
	updateLocal() {
		const info = readStoredAccounts();
		// Another tab cleared or corrupted site data mid-session: the store's state, not a bug.
		if (!info) throw new DOMException("userinfos is missing or unusable", "NotFoundError");
		info.users[this.uid] = this.toJSON();
		writeAccounts(serialiseForStore(info));
	}
	/** updateLocal for the saves that run while the app boots (name, avatar, id, status, token,
	 * localuserStore): a refused write (a full store) is logged, and the value still holds in
	 * memory for this session. Thrown, it would abort READY and the app would never boot.
	 * Returns whether the whole account saved; when it didn't, the account's own fields (a
	 * refreshed token above all) still save beside the localuserStore as last stored. */
	tryUpdateLocal(): boolean {
		try {
			this.updateLocal();
			return true;
		} catch (error) {
			if (!isStoreRefusal(error)) throw error;
			console.error(error);
			this.saveFieldsQuietly();
			return false;
		}
	}
	/** The localuserStore is what grows (perminfo kept in memory once the store refused it rides
	 * in every later save), so on a near-full store the rest of the account can still fit. It
	 * re-reads userinfos, so other accounts and the store as last saved (by any tab) stay.
	 * It reads and writes localStorage itself, past the session overlay: the refused save just
	 * before it left the whole account there, newer than this partial copy, so the overlay
	 * (and any pending handoff) must stay as it is. */
	private saveFieldsQuietly() {
		try {
			const info = parseStoredAccounts(localStorage.getItem("userinfos"));
			const saved = info?.users[this.uid] as {localuserStore?: unknown} | undefined;
			if (!info || !saved) return;
			info.users[this.uid] = {...this.toJSON(), localuserStore: saved.localuserStore};
			localStorage.setItem("userinfos", serialiseForStore(info));
		} catch (error) {
			if (!isStoreRefusal(error)) throw error;
			console.warn("Account fields (token) could not be saved:", error);
		}
	}
	/** tryUpdateLocal without the log: proxySave's retry after a refusal it already logged. */
	private updateLocalQuietly(): boolean {
		try {
			this.updateLocal();
			return true;
		} catch (error) {
			if (!isStoreRefusal(error)) throw error;
			return false;
		}
	}
}
export function trimswitcher() {
	const json = getBulkInfo();
	const map = new Map();
	for (const thing in json.users) {
		const user = json.users[thing];
		let wellknown = user.serverurls.wellknown;
		if (wellknown.at(-1) !== "/") {
			wellknown += "/";
		}
		wellknown = (user.id || user.email) + "@" + wellknown;
		if (map.has(wellknown)) {
			const otheruser = map.get(wellknown);
			if (otheruser[1].serverurls.wellknown.at(-1) === "/") {
				delete json.users[otheruser[0]];
				map.set(wellknown, [thing, user]);
			} else {
				delete json.users[thing];
			}
		} else {
			map.set(wellknown, [thing, user]);
		}
	}
	for (const thing in json.users) {
		if (thing.at(-1) === "/") {
			const user = json.users[thing];
			delete json.users[thing];
			json.users[thing.slice(0, -1)] = user;
		}
	}
	localStorage.setItem("userinfos", JSON.stringify(json));
}
function keepUnreadableAccounts(raw: string): void {
	trySetItem("userinfos.unreadable", raw);
}
export function adduser(user: typeof Specialuser.prototype.json): Specialuser {
	const suser = new Specialuser(user);
	let info = readStoredAccounts();
	if (!info) {
		const raw = readItem("userinfos");
		if (raw !== null) keepUnreadableAccounts(raw);
		info = defaultUserInfos();
	}
	info.users[suser.uid] = suser;
	info.currentuser = suser.uid;
	sessionStorage.setItem("currentuser", suser.uid);
	saveAccounts(JSON.stringify(info), {signIn: true});
	return suser;
}
/** The account the app boots: this tab's pick while that account exists, else the stored
 * default. A session-only sign-in leaves its pick behind after the reload drops the account. */
export function bootAccountId(info: {currentuser?: string | null; users: Record<string, unknown>}) {
	const pick = sessionStorage.getItem("currentuser");
	return pick && Object.hasOwn(info.users, pick) ? pick : info.currentuser;
}
class Directory {
	static home = this.createHome();
	handle: FileSystemDirectoryHandle;
	writeWorker?: Worker;
	private constructor(handle: FileSystemDirectoryHandle) {
		this.handle = handle;
	}
	static async createHome(): Promise<Directory> {
		navigator.storage.persist();
		const home = new Directory(await navigator.storage.getDirectory());
		return home;
	}
	async *getAllInDir() {
		for await (const [name, handle] of this.handle.entries()) {
			if (handle instanceof FileSystemDirectoryHandle) {
				yield [name, new Directory(handle)] as [string, Directory];
			} else if (handle instanceof FileSystemFileHandle) {
				yield [name, await handle.getFile()] as [string, File];
			}
		}
	}
	async getRawFileHandler(name: string) {
		return await this.handle.getFileHandle(name);
	}
	async getRawFile(name: string) {
		try {
			return await (await this.handle.getFileHandle(name)).getFile();
		} catch {
			return undefined;
		}
	}
	async getString(name: string): Promise<string | undefined> {
		try {
			return await (await this.getRawFile(name))!.text();
		} catch {
			return undefined;
		}
	}
	initWorker() {
		if (this.writeWorker) return this.writeWorker;
		this.writeWorker = new Worker("/utils/dirrWorker.js");
		this.writeWorker.onmessage = (event) => {
			const res = this.wMap.get(event.data[0]);
			this.wMap.delete(event.data[0]);
			if (!res) throw new Error("Res is not defined here somehow");
			res(event.data[1]);
		};
		return this.writeWorker;
	}
	wMap = new Map<number, (input: boolean) => void>();
	async setStringWorker(name: FileSystemFileHandle, value: ArrayBuffer) {
		const worker = this.initWorker();
		const random = Math.random();
		worker.postMessage([name, value, random]);
		return new Promise<boolean>((res) => {
			this.wMap.set(random, res);
		});
	}
	async setString(name: string, value: string): Promise<boolean> {
		const file = await this.handle.getFileHandle(name, {create: true});
		const contents = new TextEncoder().encode(value);

		if (file.createWritable as unknown) {
			const stream = await file.createWritable({keepExistingData: false});
			await stream.write(contents);
			await stream.close();
			return true;
		} else {
			//Curse you webkit!
			return await this.setStringWorker(file, contents.buffer as ArrayBuffer);
		}
	}
	async getDir(name: string) {
		return new Directory(await this.handle.getDirectoryHandle(name, {create: true}));
	}
}

export {Directory};

const mobile =
	/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
	(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
const iOS =
	/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
	(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export {mobile, iOS};

export function getViewportHeight() {
	return (
		window.visualViewport?.height || document.documentElement.clientHeight || window.innerHeight
	);
}

export function getViewportWidth() {
	return window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
}

/**
 * An entry of `public/instances.json`, the only instance list Machloket reads (never the
 * Spacebar Explorer catalog). `{hostname}` in `url` stands for the host the client was loaded
 * from, so one build reaches the instance from the Deck and from a phone on the LAN.
 */
type LocalInstance = {
	name: string;
	icon?: string;
	description?: string;
	url: string;
};
const localInstancesFetch = fetch(new URL("/instances.json", window.location.origin).href).then(
	async (res) => {
		if (!res.ok) {
			throw new Error("Failed to fetch instances.json");
		}
		const json: unknown = await res.json();
		if (!Array.isArray(json)) throw new Error("instances.json must be an array");
		return json.filter((entry): entry is LocalInstance => {
			const usable = typeof entry?.name === "string" && typeof entry?.url === "string";
			if (!usable) console.error("Skipping an instances.json entry without a name and url:", entry);
			return usable;
		});
	},
);
function iconUrl(icon: string | undefined) {
	if (!icon || !URL.canParse(icon, window.location.origin)) return undefined;
	return new URL(icon, window.location.origin).href;
}
function normalizeLocalInstance(instance: LocalInstance) {
	return {
		name: instance.name,
		description: instance.description,
		descriptionLong: undefined,
		image: iconUrl(instance.icon),
		url: instance.url.replaceAll("{hostname}", window.location.hostname),
		display: true,
		online: undefined,
		uptime: undefined,
		urls: undefined,
	};
}
/** Normalizes the list and indexes each instance's name to its URL, so a typed name resolves. */
export function indexInstances(json: LocalInstance[]) {
	const list = json.map(normalizeLocalInstance);
	for (const instance of list) {
		const name = instance.name.toLowerCase();
		if (name !== instance.url.toLowerCase()) stringURLMap.set(name, instance.url);
	}
	return list;
}
// Never rejects, and never waits on translations: instance lookups settle even if they fail to load.
const instancesIndexed = localInstancesFetch.then(indexInstances).catch((e) => {
	console.error("Couldn't load the instance list:", e);
	return [];
});
// Never rejects: a missing or broken list leaves the picker empty instead of stalling it.
export const instancefetch = instancesIndexed.then(async (list) => {
	await I18n.done;
	instances = list;
	instancesLoaded = true;
});

const catalogBotsUrl = "https://sbar.fyi/api/catalog/bots";
type CatalogBot = {
	id: string;
	name: string;
	maintainer?: string;
	maintainer_link?: string;
	maintainer_image?: string;
	tags?: string[];
	short?: string;
	description?: string;
};
let botCatalog: Promise<CatalogBot[]> | undefined;
/** The catalog is fetched only when a bot profile first asks — a third-party request the
 * user never asked for shouldn't ride every app start. One fetch per session; a failure
 * is cached as an empty catalog. */
function fetchBotCatalog(): Promise<CatalogBot[]> {
	botCatalog ??= fetch(catalogBotsUrl)
		.then(async (res) => {
			if (!res.ok) {
				throw new Error("Failed to fetch bot catalog");
			}
			return (await res.json()) as CatalogBot[];
		})
		.catch(() => {
			return [] as CatalogBot[];
		});
	return botCatalog;
}

export async function getExplorerBotByUsername(username: string): Promise<CatalogBot | undefined> {
	const bots = await fetchBotCatalog();
	return bots.find((bot) => bot.name.toLowerCase() === username.toLowerCase());
}

export function getExplorerBotUrl(botId: string): string {
	return new URL(`/bots/${encodeURIComponent(botId)}`, "https://sbar.fyi").href;
}

const stringURLMap = new Map<string, string>();

export interface InstanceUrls {
	admin?: string;
	api: string;
	cdn: string;
	gateway: string;
	wellknown: string;
}

export interface InstanceInfo extends InstanceUrls {
	value: string;
}

export async function getapiurls(str: string): Promise<InstanceUrls | null> {
	str = str.trim();
	if (!str) return null;

	console.info("Attempting to fetch .well-known's for", str);

	// Override first:
	let urls: InstanceUrls | null = await getInstanceInfo(str);
	if (urls) return urls;

	// Otherwise, fall back to looking it up...
	try {
		urls = await getApiUrlsV2(str);
		if (!urls) throw new Error("meow");
		return urls;
	} catch {
		return await getApiUrlsV1(str);
	}
}

//region Instance list
export async function getInstanceInfo(str: string): Promise<InstanceInfo | null> {
	// The name index fills when the list loads; an empty or failed list still settles.
	await instancesIndexed;

	console.info("Checking if we already know", str, "in our instance lists:", {
		stringURLMap,
	});

	if (stringURLMap.has(str.toLowerCase())) {
		return (await getapiurls(stringURLMap.get(str.toLowerCase())!)) as InstanceInfo;
	}

	return null;
}
//endregion

//region Well-Known v2
export async function getApiUrlsV2(str: string): Promise<InstanceUrls | null> {
	if (!URL.canParse(str)) {
		console.log("getApiUrlsV2:", str, "is not a parseable url");
		return null;
	}
	try {
		const info = await fetch(str + "/.well-known/spacebar/client").then((r) => r.json());
		let urls: InstanceUrls = {
			admin: info.admin?.baseUrl,
			api: info.api.baseUrl + "/api/v9", //We don't support anything other than v9
			gateway: info.gateway.baseUrl,
			cdn: info.cdn.baseUrl,
			wellknown: str,
		};
		const check = await checkURLs(str, urls);
		if (check) {
			urls = check;
		}
		return urls;
	} catch (e) {
		console.log("No .well-known v2 for", str, (e as Error).message);
		return null;
	}
}
//endregion

//region Well-Known v1
/** The /ping budget for instance checks: an unreachable instance must read as absent, not
 * hang the lookup forever. */
export const pingTimeoutMs = 10_000;

/** The /ping response inside the budget, or null once it passed: an abort and a network
 * failure both read as absent. (Exported for the pingGuard tests.) */
export async function pingResponse(api: URL | string): Promise<Response | null> {
	const base = api.toString();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), pingTimeoutMs);
	try {
		return await fetch(base + (base.endsWith("/") ? "" : "/") + "ping", {
			signal: controller.signal,
		});
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Whether an instance's API answers /ping, inside the budget. (Exported for the pingGuard
 * tests.) */
export async function pingOK(api: URL | string): Promise<boolean> {
	return (await pingResponse(api))?.ok === true;
}

/**
 * this function checks if a string is an instance, it'll either return the API urls or null
 * (exported for the pingGuard tests)
 */
export async function checkURLs(wellknown: string, urls: InstanceUrls) {
	if (isLoopback(urls.api) !== isLoopback(wellknown)) {
		return new Promise<InstanceUrls | null>(async (res) => {
			// goAbove: the caller may have raised its own layer (the login dialog sits at
			// z-index 200, the reconnect splash at 110); at .background's default 102 this
			// dialog opens underneath it — invisible, unclickable, and the check waits on a
			// prompt the user cannot see or click (seen live 2026-10-16).
			const menu = new Dialog("", {goAbove: true});
			const options = menu.float.options;
			options.addMDText(new MarkDown(I18n.incorrectURLS(), undefined));
			const opt = options.addOptions("", {ltr: true});
			let clicked = false;
			opt.addButtonInput("", I18n.yes(), async () => {
				if (clicked) return;
				clicked = true;
				if (urls == null) throw new Error("Unexpected undefined, exiting");
				try {
					const temp = new URL(wellknown);
					const newOrigin = temp.hostname;
					const protocol = temp.protocol;
					const tempurls = {
						api: new URL(urls.api),
						cdn: new URL(urls.cdn),
						gateway: new URL(urls.gateway),
						wellknown: new URL(urls.wellknown),
					};
					tempurls.api.host = newOrigin;
					tempurls.api.protocol = protocol;

					tempurls.cdn.host = newOrigin;
					tempurls.cdn.protocol = protocol;

					tempurls.gateway.host = newOrigin;
					tempurls.gateway.protocol = temp.protocol === "http:" ? "ws:" : "wss:";

					tempurls.wellknown.host = newOrigin;
					tempurls.wellknown.protocol = protocol;
					// Setting `host` without a port keeps the old (loopback) one: take the site's own port.
					for (const url of Object.values(tempurls)) url.port = temp.port;

					if (!(await pingOK(tempurls.api))) {
						res(null);
						menu.hide();
						return;
					}
					res({
						api: tempurls.api.toString(),
						cdn: tempurls.cdn.toString(),
						gateway: tempurls.gateway.toString(),
						wellknown: tempurls.wellknown.toString(),
					});
					menu.hide();
				} catch {
					res(null);
					menu.hide();
				}
			});
			const no = opt.addButtonInput("", I18n.no(), async () => {
				if (clicked) return;
				clicked = true;
				if (urls == null) throw new Error("URLs is undefined");
				try {
					if (!(await pingOK(urls.api))) {
						res(null);
						menu.hide();
						return;
					}
				} catch {
					res(null);
					menu.hide();
					return;
				}
				res(urls);
				menu.hide();
			});
			const span = document.createElement("span");
			options.addHTMLArea(span);
			const t = setInterval(() => {
				if (!document.contains(span)) {
					clearInterval(t);
					no.onClick();
				}
			}, 100);
			menu.show();
		});
	}
	return undefined;
}
export async function getApiUrlsV1(str: string): Promise<InstanceUrls | null> {
	function appendApi(str: string) {
		return str.includes("api") ? str : str.endsWith("/") ? str + "api" : str + "/api";
	}
	if (!URL.canParse(str)) {
		await instancesIndexed;
		const val = stringURLMap.get(str.toLowerCase());
		if (val) {
			str = val;
		} else if (!str.match(/^https?:\/\//gm)) {
			str = "https://" + str;
		}
	}
	str = trimTrailingSlashes(str);
	let api: string;
	try {
		const info = await fetch(`${str}/.well-known/spacebar`).then((x) => x.json());
		api = trimTrailingSlashes(info.api);
	} catch {
		api = str;
	}
	if (!URL.canParse(api)) {
		return null;
	}
	const url = new URL(api);
	let urls: undefined | InstanceUrls;
	function fixApi() {
		if (!urls) return;
		urls = {
			wellknown: trimTrailingSlashes(urls.wellknown),
			api: trimTrailingSlashes(urls.api),
			cdn: trimTrailingSlashes(urls.cdn),
			gateway: trimTrailingSlashes(urls.gateway),
		};
	}

	try {
		const info = await fetch(
			`${api}${url.pathname.includes("api") ? "" : "api"}/policies/instance/domains`,
		).then((x) => x.json());
		const apiurl = new URL(info.apiEndpoint);
		urls = {
			api: apiurl.origin + appendApi(apiurl.pathname),
			gateway: info.gateway,
			cdn: info.cdn,
			wellknown: str,
		};
		fixApi();
	} catch {
		// No domains answer; urls stays unset and the caller falls back.
	}
	if (urls) {
		const check = await checkURLs(str, urls);
		if (check) {
			urls = check;
		}
		//*/
		try {
			if (!(await pingOK(urls.api))) {
				return null;
			}
		} catch {
			return null;
		}
		return urls;
	}
	return null;
}
//endregion

async function isAnimated(src: string) {
	try {
		src = new URL(src).pathname;
	} catch {}
	return (
		src.endsWith(".apng") ||
		src.endsWith(".gif") ||
		src.split("/").at(-1)?.startsWith("a_") ||
		src.includes("avatar-decoration-presets")
	);
}
const staticImgMap = new Map<string, string | Promise<string>>();
export async function removeAni(elm: HTMLElement, time = 500) {
	elm.classList.add("removeElm");
	const ani = elm.getAnimations();
	await Promise.race([
		Promise.all(ani.map((_) => _.finished)),
		new Promise<void>((res) => setTimeout(res, time)),
	]);
	if (document.contains(elm)) elm.remove();
}
export type safeImg = HTMLImageElement & {
	setSrcs: (nsrc: string, nstaticsrc: string | void) => void;
	isAnimated: () => Promise<boolean>;
};
export function createImg(
	src: string | undefined,
	staticsrc: string | void,
	elm: HTMLElement | void,
	type: "gif" | "icon" = "gif",
): safeImg {
	const aniOpt = getPreferences().then((prefs) => {
		return (
			(type === "gif" ? prefs.animateGifs : prefs.animateIcons) ||
			("hover" as "hover") ||
			"always" ||
			"never"
		);
	});
	const img = document.createElement("img");
	img.loading = "lazy";
	img.decoding = "async";
	img.addEventListener("error", () => {
		img.classList.add("error");
	});
	elm ||= img;
	if (src) {
		isAnimated(src).then(async (animated) => {
			if (animated) {
				img.crossOrigin = "anonymous";
			}
			img.src = (await aniOpt) !== "always" ? staticsrc || src || "" : src || "";
		});
	}
	img.onload = async () => {
		if ((await aniOpt) === "always") return;
		if (!src) return;
		if ((await isAnimated(src)) && !staticsrc) {
			let s = staticImgMap.get(src);
			if (s) {
				staticsrc = await s;
			} else {
				staticImgMap.set(
					src,
					new Promise(async (res) => {
						try {
							const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
							const ctx = c.getContext("2d");
							if (!ctx) return res(src ?? "");
							ctx.drawImage(img, 0, 0);
							const blob = await c.convertToBlob();
							res(URL.createObjectURL(blob));
						} catch {
							res(src ?? "");
						}
					}),
				);
				staticsrc = (await staticImgMap.get(src)) as string;
			}
			img.src = staticsrc;
		}
	};
	elm.addEventListener("mouseover", async () => {
		if ((await aniOpt) === "never") return;
		if (img.src !== src && src) {
			img.src = src;
		}
	});
	elm.addEventListener("mouseleave", async () => {
		if (staticsrc && (await aniOpt) !== "always") {
			img.src = staticsrc;
		}
	});

	return Object.assign(img, {
		setSrcs: (nsrc: string, nstaticsrc: string | void) => {
			src = nsrc;
			staticsrc = nstaticsrc;
			if (src) {
				isAnimated(src).then(async (animated) => {
					if (animated) {
						img.crossOrigin = "anonymous";
					}
					img.src = (await aniOpt) !== "always" ? staticsrc || src || "" : src || "";
				});
			}
		},
		isAnimated: async () => {
			return !!(src && (await isAnimated(src)));
		},
	});
}

/**
 * Resolves `instance` (a URL or a listed instance's name) to its URLs, or undefined if it isn't
 * a reachable instance. It leaves the UI alone: checks can finish out of order, so only the
 * caller knows whether this result is still the one to show.
 */
async function checkInstance(instance: string): Promise<InstanceInfo | undefined> {
	try {
		await instancefetch;
		const instanceinfo = (await getapiurls(instance)) as InstanceInfo | null;
		if (!instanceinfo) return undefined;
		instanceinfo.value = instance;
		return instanceinfo;
	} catch {
		return undefined;
	}
}
{
	//TODO look at this and see if this can be made less hacky :P
	const originalFetch = window.fetch;
	window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
		const url = new URL(input instanceof Request ? input.url : input, window.location.href);
		if (apiDoms.has(url.host)) {
			init = init || {};
			init.credentials ??= "include";
		}

		return originalFetch(input, init);
	};
}
export {checkInstance};

export class SW {
	static worker: undefined | ServiceWorker;
	static registration: ServiceWorkerRegistration;
	static port?: MessagePort;
	static init() {
		SW.setMode(getLocalSettings().serviceWorkerMode);
		const port = new MessageChannel();
		SW.worker?.postMessage(
			{
				code: "port",
				port: port.port2,
			},
			[port.port2],
		);
		this.port = port.port1;
		this.port.onmessage = (e) => {
			this.handleMessage(e.data);
		};
		window.addEventListener("beforeunload", () => {
			this.postMessage({code: "close"});
			port.port1.close();
		});
		this.postMessage({code: "ping"});
		this.postMessage({code: "isDev", dev: getDeveloperSettings().cacheSourceMaps});
		this.captureEvent("updates", (update, stop) => {
			this.needsUpdate ||= update.updates;
			if (update.updates) {
				stop();
				void import("./assetCache.js").then(({refreshStylesheetsForUpdate}) =>
					refreshStylesheetsForUpdate(),
				);
				const updateIcon = document.getElementById("updateIcon");
				if (updateIcon) {
					updateIcon.hidden = false;
				}
			}
		});
	}
	static traceInit() {
		getBulkUsers();
	}
	static needsUpdate = false;
	static async postMessage(message: messageTo) {
		if (!("serviceWorker" in navigator)) return;
		// The default mode never starts the worker, so no port will come: don't wait for one.
		// (A port from a worker started before a switch to that mode still delivers.)
		if (!this.port && getLocalSettings().serviceWorkerMode == ServiceWorkerMode.Unregistered)
			return;
		while (!this.port) {
			await new Promise((res) => setTimeout(res, 100));
		}
		this.port.postMessage(message);
	}
	static eventListeners = new Map<
		messageFrom["code"],
		Set<(y: messageFrom, remove: () => void) => void>
	>();
	static captureEvent<X extends messageFrom["code"]>(
		name: X,
		fucny: (y: Extract<messageFrom, {code: X}>, remove: () => void) => void,
	) {
		let sett = this.eventListeners.get(name);
		if (!sett) {
			sett = new Set();
			this.eventListeners.set(name, sett);
		}
		sett.add(fucny as () => void);
	}
	static uncaptureEvent<X extends messageFrom["code"]>(
		name: X,
		fucny: (y: Extract<messageFrom, {code: X}>, remove: () => void) => void,
	) {
		let sett = this.eventListeners.get(name);
		if (!sett) return;
		sett.delete(fucny as () => void);
	}
	static async handleMessage(message: messageFrom) {
		const sett = this.eventListeners.get(message.code);
		if (sett) {
			for (const thing of sett) {
				thing(message, () => {
					this.uncaptureEvent(message.code, thing);
				});
			}
		}
		switch (message.code) {
			case "close": {
				for (const thing of await navigator.serviceWorker.getRegistrations()) {
					await thing.unregister();
				}
				await this.start();
				this.postMessage({code: "replace"});
				break;
			}
			case "closing": {
				await this.start();
				break;
			}
			case "updates": {
				break;
			}
			case "isValid": {
			}
		}
	}

	static async isValid(url: string): Promise<boolean> {
		return new Promise((res) => {
			this.captureEvent("isValid", (e, stop) => {
				if (e.url === url) {
					res(e.valid);
					stop();
				}
			});
			this.postMessage({code: "isValid", url});
		});
	}
	static async checkUpdates(): Promise<boolean> {
		if (this.needsUpdate) return true;
		return new Promise((res) => {
			this.captureEvent("updates", (update, remove) => {
				remove;
				res(update.updates);
			});
			this.postMessage({code: "CheckUpdate"});
		});
	}
	/**
	 * A module worker: Vite emits service.ts as an ES module (dev and build), whose `export {}`
	 * is a syntax error in a classic worker. Browsers without module service workers fail this
	 * registration and run without one.
	 *
	 * `notificationsOnly` registers it as a worker that leaves fetches and caches alone
	 * (service.ts reads the query).
	 */
	static register(notificationsOnly = false) {
		const url = notificationsOnly ? "/service.js?notifications" : "/service.js";
		return navigator.serviceWorker.register(url, {scope: "/", type: "module"});
	}
	/**
	 * The registration that shows notifications where the page may not construct them
	 * (Android Chrome). The default mode starts no worker, so it gets a notifications-only one;
	 * the other modes' worker (start) serves. Rejects rather than waiting forever (not
	 * `navigator.serviceWorker.ready`, which never settles without a worker and, once settled,
	 * keeps answering with a registration that may since have been unregistered).
	 */
	static async notificationRegistration(): Promise<ServiceWorkerRegistration> {
		let registration = await navigator.serviceWorker.getRegistration();
		if (!registration) {
			if (getLocalSettings().serviceWorkerMode != ServiceWorkerMode.Unregistered) {
				throw new Error("No service worker is running to show the notification");
			}
			registration = await SW.register(true);
		}
		const worker = registration.installing ?? registration.waiting;
		if (!registration.active && worker) {
			await new Promise<void>((res, rej) => {
				const timeout = setTimeout(
					() => rej(new Error("The service worker didn't activate in time")),
					10_000,
				);
				worker.addEventListener("statechange", () => {
					if (worker.state === "activated") {
						clearTimeout(timeout);
						res();
					} else if (worker.state === "redundant") {
						clearTimeout(timeout);
						rej(new Error("The service worker didn't activate"));
					}
				});
			});
		}
		return registration;
	}
	static async start() {
		if (!("serviceWorker" in navigator)) return;

		// If it's registered, it handles CDN caching regardless of settings.
		if (getLocalSettings().serviceWorkerMode == ServiceWorkerMode.Unregistered) return;
		return new Promise<void>((res) => {
			SW.register()
				.then((registration) => {
					let serviceWorker: ServiceWorker | undefined;
					if (registration.installing) {
						serviceWorker = registration.installing;
						console.log("Service worker: installing");
					} else if (registration.waiting) {
						serviceWorker = registration.waiting;
						console.log("Service worker: waiting");
					} else if (registration.active) {
						serviceWorker = registration.active;
						console.log("Service worker: active");
					}
					SW.worker = serviceWorker;
					SW.registration = registration;
					SW.init();

					if (serviceWorker) {
						console.log("Service worker state changed:", serviceWorker.state);
						serviceWorker.addEventListener("statechange", (_) => {
							console.log("Service worker state changed:", serviceWorker.state);
						});
						res();
					}
				})
				.catch((e) => {
					// E.g. a browser without module service workers: run without one.
					console.error("Service worker registration failed:", e);
					res();
				});
		});
	}
	static setMode(mode: ServiceWorkerMode) {
		const localSettings = getLocalSettings();
		localSettings.serviceWorkerMode = mode;
		setLocalSettings(localSettings);
		if (this.worker) {
			this.worker.postMessage({data: mode, code: "setMode"});
		}

		if (mode === ServiceWorkerMode.Unregistered)
			this.registration?.unregister().then((r) => console.log("Service worker unregistered:", r));
	}

	static forceClear() {
		if (this.worker) {
			this.worker.postMessage({code: "ForceClear"});
		}
	}
}
SW.start();
let installPrompt: Event | undefined = undefined;
window.addEventListener("beforeinstallprompt", (event) => {
	event.preventDefault();
	installPrompt = event;
});
export function installPGet() {
	return installPrompt;
}

export function getInstances() {
	return instances ?? [];
}

/**
 * The instance a new login starts on: the first usable listed one whose scheme matches the
 * page's, else the first usable one. Valid once `instancefetch` settles.
 */
export function getDefaultInstanceUrl(protocol = window.location.protocol): string | undefined {
	// Same scheme as the page: an https page can't call an http instance (mixed content), and
	// an http page is usually where the https address isn't reachable (the Deck itself).
	let fallback: string | undefined;
	for (const instance of getInstances()) {
		const url = instance.url || instance.urls?.wellknown;
		if (instance.display === false || instance.online === false || !url) continue;
		if (URL.canParse(url) && new URL(url).protocol === protocol) return url;
		fallback ??= url;
	}
	return fallback;
}

export function isInstanceListLoaded() {
	return instancesLoaded;
}

export function getStringURLMap() {
	return stringURLMap;
}

export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number = 350,
): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return function executedFunction(...args: Parameters<T>) {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}
