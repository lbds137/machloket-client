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
import {API_TIMEOUT_MS, apiFetch} from "./apiFetch.js";
import {
	type AccountAuth,
	AUTH_OPT_IN_HEADER,
	buildAccountHeaders,
	cookieModeHosts,
	credentialsFor,
	CSRF_HEADER,
} from "./accountHeaders.js";

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
			const host = new URL(user.serverurls.api).host;
			apiDoms.add(host);
			// Add-only: a stale entry only withholds credentials from unmarked requests.
			if (user.serverurls.authCookie === true || user.authMode === "cookie") {
				cookieModeHosts.add(host);
			}
		} catch {
			delete json.users[thing];
		}
	}
	// A pending logout's cookie is still in the browser, whatever accounts remain.
	for (const host of Object.keys(json.pendingLogouts ?? {})) cookieModeHosts.add(host);
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
	/** API host -> its API base: a removed cookie account whose logout failed (TASK-149). */
	pendingLogouts?: Record<string, string>;
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
	const pending = (info as {pendingLogouts?: unknown}).pendingLogouts;
	if (pending !== undefined) {
		// Another build or an extension may have written it: keep only API bases whose host is
		// their key, so no reader throws on one and the next save writes the store clean.
		(info as {pendingLogouts?: Record<string, string>}).pendingLogouts =
			validPendingLogouts(pending);
	}
	return info as {users: Record<string, any>};
}
function validPendingLogouts(pending: unknown): Record<string, string> {
	const valid: Record<string, string> = {};
	if (!pending || typeof pending !== "object" || Array.isArray(pending)) return valid;
	for (const [host, api] of Object.entries(pending)) {
		if (typeof api !== "string") continue;
		try {
			if (new URL(api).host === host) valid[host] = api;
		} catch {
			// Not a URL: dropped.
		}
	}
	return valid;
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
// The deliberate exception to saveAccounts as the one userinfos writer: it fills in defaults on
// the stored list itself, and a refusal must not put a defaults-only list in the overlay.
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
const liveSpecialUsers = new Set<WeakRef<Specialuser>>();
const liveSpecialUserRegistry = new FinalizationRegistry<WeakRef<Specialuser>>((ref) => {
	liveSpecialUsers.delete(ref);
});
export class Specialuser {
	serverurls: InstanceUrls;
	email: string;
	/** A header account's token; a cookie account has none. */
	token?: string;
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
		this.json = json;
		this.json.loggedin ??= true;
		this.json.localuserStore ??= {};
		const ref = new WeakRef(this);
		liveSpecialUsers.add(ref);
		liveSpecialUserRegistry.register(this, ref);
		if (!this.serverurls || !this.email || (!this.token && this.authMode !== "cookie")) {
			console.error("There are fundamentally missing pieces of info missing from this user");
		}
	}
	get authMode(): "cookie" | undefined {
		return this.json.auth_mode === "cookie" ? "cookie" : undefined;
	}
	set loggedin(e: boolean | undefined) {
		this.json.loggedin = e;
		this.tryUpdateLocal();
	}
	get loggedin(): boolean | undefined {
		return this.json.loggedin;
	}
	async logout() {
		let ended = false;
		for (let i = 0; i < 3; i++) {
			try {
				const res = await apiFetch(this.serverurls.api + "/auth/logout", {
					method: "POST",
					headers: buildAccountHeaders(this, {json: false}),
				});
				// A 401 means the session was already dead: logged out all the same.
				ended = res.ok || res.status === 401;
				if (ended) break;
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
		// Removed with its session still live: the cookie stays in the browser, so the next start
		// retries its logout. A header account's token goes with its record; a cookie retry would
		// end some other account's session, not this one's.
		this.remove(!ended && this.authMode === "cookie" ? this.serverurls.api : undefined);
		return true;
	}
	/** Removes this account from the store. `orphanedCookieApi`, for a cookie account whose
	 * session outlived it, records the pending logout in the same write: no state in between
	 * holds both the live account and the entry (another tab's retry would drop it). */
	remove(orphanedCookieApi?: string) {
		if (sessionStorage.getItem("currentuser") === this.uid) {
			sessionStorage.removeItem("currentuser");
		}
		const info = readStoredAccounts();
		if (!info) {
			if (orphanedCookieApi !== undefined) {
				console.warn(
					"userinfos store is unreadable: the pending logout for",
					orphanedCookieApi,
					"can't be recorded; its cookie stays until a login or logout on that host",
				);
			}
			return;
		}
		delete info.users[this.uid];
		if (orphanedCookieApi !== undefined) addPendingLogout(info, orphanedCookieApi);
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
				// The refused retry left the session overlay (and any pending hand-off) holding
				// the account without it; write again so they hold what memory holds (refused
				// too, the write still updates them).
				Reflect.set(target, p, newValue, receiver);
				this.updateLocalQuietly();
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
function keepUnreadableAccounts(raw: string): void {
	trySetItem("userinfos.unreadable", raw);
}
export function adduser(user: typeof Specialuser.prototype.json): Specialuser {
	const suser = new Specialuser(user);
	let info = readStoredAccounts();
	const unreadable = info ? null : readItem("userinfos");
	info ??= defaultUserInfos();
	const slot = cookieSlot(suser.serverurls.api);
	const replaced = info.users[suser.uid];
	// The replaced record's live cookie, unless this login takes over its slot: a header login,
	// or a cookie login on another hostname (the instance's API moved), leaves it with no
	// record, so the next start ends it like any other orphaned cookie, at its own API base.
	const replacedApi: unknown = replaced?.serverurls?.api;
	let replacedSlot: string | undefined;
	try {
		if (typeof replacedApi === "string") replacedSlot = cookieSlot(replacedApi);
	} catch {
		// A stored record whose API isn't a URL holds no cookie this client could end.
	}
	const orphans =
		replacedSlot !== undefined &&
		holdsCookieSlot(replaced, replacedSlot) &&
		!(suser.authMode === "cookie" && replacedSlot === slot);
	if (suser.authMode === "cookie") {
		// The browser keeps one cookie per hostname, whatever the port, and it is this login's
		// now: a pending retry would end this session, and another cookie record on the hostname
		// would send this account's session as its own. Dropping a pending logout strands no live
		// session by the server contract (docs/design/token-storage.md): over another user's valid
		// cookie the server ignores the opt-in and answers a token, so that login never reaches
		// here, and a login by the same user ends the old cookie's session as it replaces it.
		for (const host of Object.keys(info.pendingLogouts ?? {})) {
			if (hostnameOf(host) === slot) delete info.pendingLogouts![host];
		}
		for (const [uid, other] of Object.entries(info.users)) {
			if (uid === suser.uid || !holdsCookieSlot(other, slot)) continue;
			other.loggedin = false;
			delete other.auth_mode;
		}
		cookieModeHosts.add(new URL(suser.serverurls.api).host);
	}
	if (orphans) addPendingLogout(info, replacedApi as string);
	info.users[suser.uid] = suser;
	info.currentuser = suser.uid;
	sessionStorage.setItem("currentuser", suser.uid);
	saveAccounts(JSON.stringify(info), {signIn: true});
	// After the account: on a near-full store the copy must not take the account's room. Kept
	// even when the account was refused: the raw value then still sits in userinfos, and the
	// next write that lands (a token refresh) would replace it with no copy.
	if (unreadable !== null) keepUnreadableAccounts(unreadable);
	return suser;
}
/** The account a login, register or second-factor answer signs in, or null when the answer
 * carries no session. A body `token` wins: the server answers one when it ignored the opt-in. */
export function adduserFromAuth(
	res: {token?: unknown; auth_mode?: unknown},
	serverurls: InstanceUrls,
	email: string,
): Specialuser | null {
	if (typeof res.token === "string") return adduser({serverurls, email, token: res.token});
	if (res.auth_mode === "cookie") return adduser({serverurls, email, auth_mode: "cookie"});
	return null;
}

//region Cookie sessions (TASK-149)
/** The cookie slot an API base's session cookie lives in: its hostname. Cookies ignore the
 * port, so two API ports on one hostname share one cookie. */
function cookieSlot(api: string): string {
	return new URL(api).hostname;
}
/** The hostname of a `host[:port]` key (pendingLogouts keys, cookieModeHosts entries). */
function hostnameOf(host: string): string {
	return new URL("http://" + host).hostname;
}
/** Whether a stored account record is a logged-in cookie account in cookie slot `slot`: the
 * slot's one cookie is then that account's. */
function holdsCookieSlot(u: any, slot: string): boolean {
	if (u?.auth_mode !== "cookie" || u.loggedin === false) return false;
	try {
		return cookieSlot(u.serverurls.api) === slot;
	} catch {
		return false;
	}
}
function slotHasCookieAccount(users: Record<string, any> | undefined, slot: string): boolean {
	return Object.values(users ?? {}).some((u) => holdsCookieSlot(u, slot));
}
/** Runs `fn` holding the cookie slot's lock, shared across tabs where the browser has Web
 * Locks. */
async function withCookieLock<T>(slot: string, fn: () => Promise<T>): Promise<T> {
	if (!navigator.locks) return fn();
	return navigator.locks.request("machloket-cookie-session:" + slot, fn);
}
/** Pending-logout retries this page started, by API host. They never reject. */
const pendingLogoutRuns = new Map<string, Promise<void>>();

/** The lock a cookie login on the slot holds while it is out. */
function cookieLoginLockName(slot: string): string {
	return "machloket-cookie-login:" + slot;
}
/** Takes `name` if no one holds it and resolves to its release, or to null when it is held.
 * The browser drops it with the page, so a closed or crashed tab never holds it. */
function tryHoldLock(name: string): Promise<(() => void) | null> {
	return new Promise((settled, refused) => {
		navigator.locks
			.request(name, {ifAvailable: true}, (lock) => {
				if (!lock) {
					settled(null);
					return;
				}
				return new Promise<void>((release) => settled(release));
			})
			.catch(refused);
	});
}
/** Whether a cookie login on the slot is out, in this tab or another. */
async function cookieLoginInFlight(slot: string): Promise<boolean> {
	if (!navigator.locks) return false;
	return navigator.locks.request(
		cookieLoginLockName(slot),
		{ifAvailable: true},
		async (lock) => lock === null,
	);
}

/**
 * The opt-in headers for a login, register or second-factor request to `instance`, with the
 * release of the login's hold, or undefined when it shouldn't ask for a cookie: discovery
 * didn't offer cookie sessions, a logged-in cookie account already holds the host's cookie, or
 * another cookie login on the hostname is out (this tab's or another's: the browser keeps one
 * cookie there, and two logins' answers could land in either order, so this one goes by token).
 * It first waits for any retry of the host's pending logout already running here or in another
 * tab, so that retry can't end the session this request starts. Until released, the hold makes
 * any later retry on the hostname (another tab's start) leave its pending logout for a later
 * start: the login's cookie may land before its account is stored. The slot's lock itself isn't
 * held through the login, which can wait minutes on a second factor while another tab's start
 * waits on that lock to migrate. Without Web Locks (an insecure context) there is no hold.
 */
async function cookieOptIn(
	instance: InstanceUrls,
): Promise<{headers: Record<string, string>; release: () => void} | undefined> {
	if (instance.authCookie !== true) return undefined;
	const slot = cookieSlot(instance.api);
	if (slotHasCookieAccount(readStoredAccounts()?.users, slot)) return undefined;
	await Promise.all(
		[...pendingLogoutRuns].filter(([host]) => hostnameOf(host) === slot).map(([, run]) => run),
	);
	// Another tab's retry holds the slot's lock for as long as its request is out. The hold is
	// taken under it, so a retry that gets the lock next sees the login.
	const release = await withCookieLock(slot, async () => {
		// Re-read: a cookie login may have been stored while this one waited.
		if (slotHasCookieAccount(readStoredAccounts()?.users, slot)) return null;
		if (!navigator.locks) return () => {};
		return tryHoldLock(cookieLoginLockName(slot));
	});
	if (!release) return undefined;
	return {headers: {[AUTH_OPT_IN_HEADER]: "cookie", [CSRF_HEADER]: "1"}, release};
}
/** A login or register form's cookie opt-in: each submit to a cookie-session instance asks for
 * a cookie and holds pending-logout retries off until the submit is over (cookieOptIn). */
export function addCookieOptIn(
	form: {
		submitHeaders?: (sent: object) => Promise<Record<string, string> | undefined>;
		submitSettled?: (sent: object) => void;
	},
	instanceFor: (sent: object) => InstanceUrls | undefined,
): void {
	const releases = new WeakMap<object, () => void>();
	form.submitHeaders = async (sent) => {
		const instance = instanceFor(sent);
		const optIn = instance ? await cookieOptIn(instance) : undefined;
		if (!optIn) return undefined;
		releases.set(sent, optIn.release);
		return optIn.headers;
	};
	form.submitSettled = (sent) => {
		releases.get(sent)?.();
		releases.delete(sent);
	};
}

/** Records in `info` (the caller saves it) that the cookie on `api`'s host outlived its
 * account, for the next start to end. */
function addPendingLogout(info: {pendingLogouts?: Record<string, string>}, api: string): void {
	const host = new URL(api).host;
	cookieModeHosts.add(host);
	info.pendingLogouts = {...info.pendingLogouts, [host]: api};
}
/** Clears the host's pending logout if it is still the one for `api`: one written meanwhile is
 * a newer orphaned cookie, still to end. */
function clearPendingLogout(host: string, api: string): void {
	const info = readStoredAccounts();
	if (info?.pendingLogouts?.[host] !== api) return;
	delete info.pendingLogouts[host];
	saveAccounts(serialiseForStore(info));
}
/** Whether a logout answer ends the pending logout: done (2xx) or already dead (401). Anything
 * else (a CSRF or Origin refusal, a 5xx, a rate limit) leaves the cookie possibly live, so the
 * next start tries again. */
function endsPendingLogout(status: number): boolean {
	return (status >= 200 && status < 300) || status === 401;
}
async function retryPendingLogout(host: string): Promise<void> {
	await withCookieLock(hostnameOf(host), async () => {
		// A cookie login is out on the hostname: the cookie may be its session already. Kept for
		// a later start; a cookie login that lands drops it (adduser). Asked before the store is
		// read: no login can start while this run holds the slot's lock, so a free answer means
		// any earlier login has already stored its account, and the read below sees it.
		if (await cookieLoginInFlight(hostnameOf(host))) return;
		// Read under the lock: a cookie login stored since owns the cookie now, and the entry may
		// have been replaced while this run waited.
		const info = readStoredAccounts();
		const api = info?.pendingLogouts?.[host];
		if (!info || !api) return;
		if (slotHasCookieAccount(info.users, hostnameOf(host))) {
			clearPendingLogout(host, api);
			return;
		}
		let res: Response;
		try {
			res = await apiFetch(trimTrailingSlashes(api) + "/auth/logout", {
				method: "POST",
				headers: {[CSRF_HEADER]: "1"},
				credentials: "include",
			});
		} catch (e) {
			console.warn("Pending logout for", host, "got no answer; retrying at the next start", e);
			return;
		}
		if (endsPendingLogout(res.status)) clearPendingLogout(host, api);
	});
}
/**
 * Retries every pending logout by cookie. The app's start runs it (never module load: a test
 * file importing this module would send it); a cookie opt-in on the same host waits for it.
 */
export function runPendingLogouts(): Promise<void> {
	const pending = readStoredAccounts()?.pendingLogouts ?? {};
	const runs = Object.keys(pending).map((host) => {
		const run = retryPendingLogout(host)
			// A failed run (a lock or store error) waits for the next start; it must not stall a
			// login waiting on it, nor reject unhandled at start.
			.catch((e) =>
				console.warn("Pending logout for", host, "failed; retrying at the next start", e),
			)
			.finally(() => {
				if (pendingLogoutRuns.get(host) === run) pendingLogoutRuns.delete(host);
			});
		pendingLogoutRuns.set(host, run);
		return run;
	});
	return Promise.all(runs).then(() => {});
}

//region Moving header sessions into the cookie (TASK-150)
type CookieSessionListener = {cookieSessionAdopted(uid: string): void};
/** Told when an account's session moved into the cookie: each live Localuser, which re-applies
 * its headers in place and reconnects a gateway that closed on the dead token. Held weakly, so
 * a Localuser swapped away isn't kept alive by it. */
const cookieSessionListeners = new Set<WeakRef<CookieSessionListener>>();
export function onCookieSessionAdopted(listener: CookieSessionListener): void {
	cookieSessionListeners.add(new WeakRef(listener));
}
function announceCookieSession(uid: string): void {
	for (const ref of cookieSessionListeners) {
		const listener = ref.deref();
		if (!listener) {
			cookieSessionListeners.delete(ref);
			continue;
		}
		try {
			listener.cookieSessionAdopted(uid);
		} catch (e) {
			console.error("A listener failed on the move into the cookie session:", e);
		}
	}
}
/** Whether `api`'s host offers cookie sessions as far as this page can tell. Re-reads the store
 * beside the page's set: a tab started before the host turned cookie mode on learns it from the
 * record another tab's start refreshed. */
function isCookieModeApi(api: string): boolean {
	const host = new URL(api).host;
	if (cookieModeHosts.has(host)) return true;
	const info = readStoredAccounts();
	if (Object.hasOwn(info?.pendingLogouts ?? {}, host)) return true;
	return Object.values(info?.users ?? {}).some((u) => {
		try {
			return (
				new URL(u.serverurls.api).host === host &&
				(u.serverurls.authCookie === true || u.auth_mode === "cookie")
			);
		} catch {
			return false;
		}
	});
}
/** The id of the user whose session the browser's cookie on `api`'s host holds: a string on a
 * 200 naming one, null when the server said there is none (a 401) or answered a JSON 200
 * without an id, undefined when it gave no verdict (no answer, a redirect, a body cut off or not
 * JSON - a proxy's page -, a 429 or 5xx). Raw fetch, briefly timed, never cached: it runs inside
 * the 401 path, which apiFetch would re-enter. */
async function cookieSessionUserId(api: string): Promise<string | null | undefined> {
	let text: string;
	try {
		const res = await fetch(trimTrailingSlashes(api) + "/users/@me", {
			headers: {[CSRF_HEADER]: "1"},
			credentials: "include",
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		});
		if (res.status === 401) return null;
		if (res.status !== 200) return undefined;
		text = await res.text();
	} catch {
		return undefined;
	}
	try {
		const body: unknown = JSON.parse(text);
		const id = (body as {id?: unknown} | null)?.id;
		return typeof id === "string" && id ? id : null;
	} catch {
		return undefined;
	}
}
/** Whether converting `uid` to the slot's cookie would override a later decision: a logout
 * pending on the slot (the cookie is to end), the account logged out, or a newer header login
 * stored for it. A stored cookie record is the same move made by another tab; no stored record
 * is an account this page holds for the session only. */
function cookieAdoptionIsStale(uid: string, deadToken: string, slot: string): boolean {
	const info = readStoredAccounts();
	if (Object.keys(info?.pendingLogouts ?? {}).some((host) => hostnameOf(host) === slot))
		return true;
	const stored = info?.users[uid] as
		{token?: unknown; auth_mode?: unknown; loggedin?: unknown} | undefined;
	if (!stored) return false;
	if (stored.loggedin === false) return true;
	return stored.auth_mode !== "cookie" && !holdsCredential(stored, {uid, token: deadToken});
}
/**
 * Converts the records of `uid` that still hold `deadToken` into cookie accounts, after the
 * server confirmed the browser's cookie on `api`'s hostname is that account's session: the
 * exchange's 204, or a cookie probe answering its user id. The caller holds the slot's lock.
 * The account record saves through tryUpdateLocal (refusal semantics: utils/accountSave.test.ts);
 * the slot's other state goes in a second write, as the cookie now belongs to this account: a
 * pending logout there would end it, and another cookie record there would send it as its own.
 */
function adoptCookieSession(uid: string, deadToken: string, api: string): void {
	const dead: AccountAuth = {uid, token: deadToken};
	let saver: Specialuser | undefined;
	for (const ref of liveSpecialUsers) {
		const u = ref.deref();
		if (!u) {
			liveSpecialUsers.delete(ref);
			continue;
		}
		if (u.uid !== uid || !holdsCredential(u.json, dead)) continue;
		u.json.auth_mode = "cookie";
		delete u.json.token;
		u.token = undefined;
		saver = u;
	}
	const before = readStoredAccounts();
	const storedRecord = before?.users[uid] as {token?: unknown; auth_mode?: unknown} | undefined;
	// Over a newer login stored since (another tab's), the whole-record save would undo it.
	const storedHoldsDead = !!storedRecord && holdsCredential(storedRecord, dead);
	if (saver && (storedHoldsDead || !storedRecord)) saver.tryUpdateLocal();
	const slot = cookieSlot(api);
	const info = readStoredAccounts();
	if (info) {
		let changed = false;
		for (const host of Object.keys(info.pendingLogouts ?? {})) {
			if (hostnameOf(host) !== slot) continue;
			delete info.pendingLogouts![host];
			changed = true;
		}
		for (const [otherUid, other] of Object.entries(info.users)) {
			if (otherUid === uid) {
				// No live copy to save it (another tab's 401 path): convert the stored one.
				if (!saver && other && holdsCredential(other, dead)) {
					other.auth_mode = "cookie";
					delete other.token;
					changed = true;
				}
				continue;
			}
			if (!holdsCookieSlot(other, slot)) continue;
			other.loggedin = false;
			delete other.auth_mode;
			changed = true;
		}
		if (changed) saveAccounts(serialiseForStore(info));
	}
	cookieModeHosts.add(new URL(api).host);
	announceCookieSession(uid);
}
/** Converts `account` when the cookie is its own session (the probe answers its user id) and no
 * later decision stands in the way (cookieAdoptionIsStale), under the caller's slot lock. True
 * when converted; false when the cookie is someone else's or dead, the record has no id to
 * compare, or the move is stale; undefined when the probe gave no verdict. */
async function adoptCookieIfSameUser(
	account: AccountAuth,
	deadToken: string,
): Promise<boolean | undefined> {
	const api = account.serverurls?.api;
	if (!api || typeof account.id !== "string" || !account.id) return false;
	const found = await cookieSessionUserId(api);
	if (found === undefined) return undefined;
	if (found !== account.id) return false;
	// Read after the probe: a logout can land while it is out.
	if (cookieAdoptionIsStale(account.uid, deadToken, cookieSlot(api))) return false;
	adoptCookieSession(account.uid, deadToken, api);
	return true;
}
/**
 * The 401 path's second look at a header account whose token probe answered 401: on a host that
 * offers cookie sessions, the session may have moved into the cookie (another tab's migration,
 * or this one's whose save was refused). "adopted" when the cookie is the account's own and the
 * record is converted, "dead" when the account is to be logged out as before, "unanswered" when
 * the cookie probe got no answer (left alone, as an unanswered token probe is).
 */
export async function cookieVerdictFor401(
	account: AccountAuth,
): Promise<"adopted" | "dead" | "unanswered"> {
	const api = account.serverurls?.api;
	const token = account.token;
	if (account.authMode === "cookie" || typeof token !== "string" || !token || !api) return "dead";
	if (!isCookieModeApi(api)) return "dead";
	return withCookieLock(cookieSlot(api), async () => {
		const adopted = await adoptCookieIfSameUser(account, token);
		return adopted === true ? "adopted" : adopted === undefined ? "unanswered" : "dead";
	});
}
/** The exchange answers fast or not at all; the app's start waits on it. */
const SESSION_COOKIE_EXCHANGE_MS = 10_000;
/**
 * Moves the current account's header session into the cookie at start: its own discovery
 * refreshes the stored `authCookie` (a plain start runs none otherwise), and when the instance
 * offers cookie sessions and no logged-in cookie account holds the hostname's cookie, it calls
 * `POST /auth/session-cookie`. A 204 converts the record; a 401 (another tab moved it already)
 * converts it when the cookie probe answers this user; anything else, or no answer, keeps the
 * header account. It waits for the host's pending-logout retry, then holds the slot's lock from
 * the check through the record's save. Never throws: the start goes on with whatever it got.
 */
export async function migrateToCookieSession(user: Specialuser): Promise<void> {
	try {
		if (user.authMode === "cookie" || user.loggedin === false) return;
		if (typeof user.token !== "string") return;
		const api = user.serverurls.api;
		const offered = await discoverAuthCookie(api);
		if (offered !== undefined && offered !== user.serverurls.authCookie) {
			user.serverurls.authCookie = offered; // the record's own serverurls object
			user.tryUpdateLocal();
		}
		if (user.serverurls.authCookie !== true) return;
		cookieModeHosts.add(new URL(api).host);
		const slot = cookieSlot(api);
		await Promise.all(
			[...pendingLogoutRuns].filter(([host]) => hostnameOf(host) === slot).map(([, run]) => run),
		);
		await withCookieLock(slot, async () => {
			if (slotHasCookieAccount(readStoredAccounts()?.users, slot)) return;
			const token = user.token;
			if (user.authMode === "cookie" || typeof token !== "string") return;
			let res: Response;
			try {
				// Untagged headers: this request's 401 is answered here, not by the 401 path.
				res = await apiFetch(
					trimTrailingSlashes(api) + "/auth/session-cookie",
					{
						method: "POST",
						headers: {Authorization: token, [AUTH_OPT_IN_HEADER]: "cookie", [CSRF_HEADER]: "1"},
					},
					{timeoutMs: SESSION_COOKIE_EXCHANGE_MS},
				);
			} catch (e) {
				console.warn("The session cookie exchange got no answer; staying on the token", e);
				return;
			}
			if (res.status === 204) adoptCookieSession(user.uid, token, api);
			else if (res.status === 401) await adoptCookieIfSameUser(user, token);
			// 403 (cookie mode off for this origin, a bot) and 409 (another user's cookie) change
			// nothing on the server: the header account stays.
		});
	} catch (e) {
		console.warn("Moving the session into the cookie failed; staying on the token", e);
	}
}
//endregion
function isValidAccount(user: unknown): boolean {
	return Boolean(
		user && typeof user === "object" && (user as {loggedin?: unknown}).loggedin !== false,
	);
}
/** Whether a stored or live account record holds the credential the probe found dead. A record
 * for the same uid with another credential is a newer login (another tab's), not this session. */
function holdsCredential(record: {token?: unknown; auth_mode?: unknown}, dead: AccountAuth) {
	if (dead.authMode === "cookie") return record.auth_mode === "cookie";
	return (
		typeof dead.token === "string" && record.auth_mode !== "cookie" && record.token === dead.token
	);
}
/** Marks invalid the records of the 401'd request's account that still hold its dead credential,
 * persisting through tryUpdateLocal so E5 save-refusal semantics apply. A record of the same uid
 * holding another credential (a re-login stored since) stays. Returns whether anything matched. */
export function invalidateAccount(dead: AccountAuth): boolean {
	const uid = dead.uid;
	let matched = 0;
	const handled = new Set<string>();
	// Several live instances can share one uid (getBulkUsers constructs a fresh
	// Specialuser per call), so the flip and any rollback must reach every matching
	// instance while the save goes through the last-constructed one.
	const toSave = new Map<string, Specialuser[]>();
	for (const ref of liveSpecialUsers) {
		const u = ref.deref();
		if (!u) {
			liveSpecialUsers.delete(ref);
			continue;
		}
		if (u.uid === uid && holdsCredential(u.json, dead)) {
			matched++;
			handled.add(u.uid);
			if (u.json.loggedin !== false) {
				const group = toSave.get(u.uid);
				if (group) group.push(u);
				else toSave.set(u.uid, [u]);
			}
		}
	}
	const storedRecord = (raw: unknown) =>
		(raw instanceof Specialuser ? raw.json : raw) as
			{token?: unknown; auth_mode?: unknown} | null | undefined;
	const before = readStoredAccounts();
	for (const instances of toSave.values()) {
		// The save writes the whole record: over a newer login's, it would put the dead token
		// back, and with no record (another tab removed the account) it would re-add it. So it
		// saves only over a record still holding the dead credential; otherwise only these live
		// instances flip, and the store stays as it is.
		const stored = storedRecord(before?.users[uid]);
		const persist = !!stored && typeof stored === "object" && holdsCredential(stored, dead);
		const prevs = instances.map((u) => ({
			loggedin: u.json.loggedin,
			hasAuthMode: "auth_mode" in u.json,
			authMode: u.json.auth_mode,
		}));
		for (const u of instances) {
			u.json.loggedin = false; // raw write: the setter would save mid-loop
			delete u.json.auth_mode;
		}
		try {
			if (persist) instances[instances.length - 1].tryUpdateLocal();
		} catch (e) {
			instances.forEach((u, i) => {
				u.json.loggedin = prevs[i].loggedin; // raw write (see above)
				if (prevs[i].hasAuthMode) u.json.auth_mode = prevs[i].authMode;
			});
			// A non-refusal throw ends the pass on purpose — later groups and the
			// stored-accounts pass stay untouched, and the released 401 latch lets the
			// next attempt redo the whole invalidation.
			throw e;
		}
	}
	const info = readStoredAccounts();
	if (info) {
		for (const [storedUid, raw] of Object.entries(info.users)) {
			if (!raw || typeof raw !== "object") continue;
			if (storedUid !== uid) continue;
			if (handled.has(storedUid)) continue;
			const record = storedRecord(raw);
			if (!record || !holdsCredential(record, dead)) continue;
			matched++;
			if ((raw as {loggedin?: unknown}).loggedin === false) continue;
			try {
				const suser = raw instanceof Specialuser ? raw : new Specialuser(raw);
				delete suser.json.auth_mode;
				suser.loggedin = false;
			} catch {
				delete (raw as {auth_mode?: unknown}).auth_mode;
				(raw as {loggedin?: boolean}).loggedin = false;
				try {
					saveAccounts(serialiseForStore(info));
				} catch (e) {
					// E5: a refused save warns — it never throws out of the 401 path.
					console.warn("machloket: account invalidation could not persist:", e);
				}
			}
		}
	}
	return matched > 0;
}
/** The account the app boots: this tab's pick while that account exists, else the stored
 * default. A session-only sign-in leaves its pick behind after the reload drops the account. */
export function bootAccountId(info: {currentuser?: string | null; users: Record<string, unknown>}) {
	const pick = sessionStorage.getItem("currentuser");
	if (pick && Object.hasOwn(info.users, pick) && isValidAccount(info.users[pick])) return pick;
	if (
		info.currentuser &&
		Object.hasOwn(info.users, info.currentuser) &&
		isValidAccount(info.users[info.currentuser])
	) {
		return info.currentuser;
	}
	for (const [uid, user] of Object.entries(info.users)) {
		if (isValidAccount(user)) return uid;
	}
	// Nothing bootable. Callers route both "no pick" and "a pick that is not a stored
	// account" to the login page off null (index.ts), so a raw id says nothing null doesn't.
	return null;
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
		// This exact form is what Vite recognises and bundles; the build never shipped the
		// literal /utils/dirrWorker.js path this used to name.
		this.writeWorker = new Worker(new URL("./dirrWorker.ts", import.meta.url));
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

const stringURLMap = new Map<string, string>();

export interface InstanceUrls {
	admin?: string;
	api: string;
	cdn: string;
	gateway: string;
	wellknown: string;
	/** Whether the instance's discovery (`/policies/instance/domains`) offers this client
	 * origin cookie sessions. Absent when discovery didn't answer: a refresh then keeps the
	 * stored value (keepAuthCookie). */
	authCookie?: boolean;
}

export interface InstanceInfo extends InstanceUrls {
	value: string;
}

/** Resolves `str` to its instance's URLs, with discovery's `authCookie` when it answered. */
export async function getapiurls(str: string): Promise<InstanceUrls | null> {
	const urls = await resolveApiUrls(str);
	if (!urls) return null;
	const authCookie = await discoverAuthCookie(urls.api);
	if (authCookie !== undefined) urls.authCookie = authCookie;
	if (authCookie) cookieModeHosts.add(new URL(urls.api).host);
	return urls;
}

/** A refreshed discovery that got no `authCookie` answer keeps the one `old` had. */
export function keepAuthCookie<T extends InstanceUrls>(fresh: T, old: InstanceUrls | undefined): T {
	if (fresh.authCookie === undefined && old?.authCookie !== undefined) {
		fresh.authCookie = old.authCookie;
	}
	return fresh;
}

/** A shorter budget than the well-known's: the URLs are already known, and a login must not
 * wait 30 s on a flag. */
const AUTH_COOKIE_DISCOVERY_MS = 5000;
/** Discovery's `authCookie` for the instance at `api`: true or false when it answered, undefined
 * when it didn't (an error status, no answer or a body that isn't our JSON). Its own request,
 * though getApiUrlsV2 reads the same route: that one asks the base before resolution, and
 * checkURLs may then swap the URLs; the flag must come from the API the account will use. That
 * API is already resolved, so apiFetch's refused redirect is right here (unlike discoveryJson). */
async function discoverAuthCookie(api: string): Promise<boolean | undefined> {
	try {
		const res = await apiFetch(trimTrailingSlashes(api) + "/policies/instance/domains", undefined, {
			timeoutMs: AUTH_COOKIE_DISCOVERY_MS,
		});
		if (!res.ok) return undefined;
		const body: unknown = await res.json();
		if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
		return (body as {authCookie?: unknown}).authCookie === true;
	} catch {
		return undefined;
	}
}

async function resolveApiUrls(str: string): Promise<InstanceUrls | null> {
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
		// The resolver, not getapiurls: the outer getapiurls runs discovery once for both.
		return (await resolveApiUrls(stringURLMap.get(str.toLowerCase())!)) as InstanceInfo;
	}

	return null;
}
//endregion

//region Well-Known v2
/** Instance discovery's GET: answers within the API budget or throws. Redirects are followed
 * (raw fetch, not apiFetch): a well-known may redirect (spacebar.chat's adds a trailing slash),
 * and no token rides along. The timer covers the body read too. */
async function discoveryJson(url: string): Promise<any> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
	try {
		return await (await fetch(url, {signal: controller.signal})).json();
	} finally {
		clearTimeout(timer);
	}
}

export async function getApiUrlsV2(str: string): Promise<InstanceUrls | null> {
	if (!URL.canParse(str)) {
		console.log("getApiUrlsV2:", str, "is not a parseable url");
		return null;
	}
	try {
		const info = await discoveryJson(str + "/.well-known/spacebar/client");
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
	try {
		return await apiFetch(base + (base.endsWith("/") ? "" : "/") + "ping", {
			timeoutMs: pingTimeoutMs,
		});
	} catch {
		return null;
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
	// `localhost:3001` parses as a URL (scheme `localhost:`), so a parse alone doesn't say the
	// address names a web scheme.
	if (!URL.canParse(str) || !/^https?:\/\//i.test(str)) {
		await instancesIndexed;
		const val = stringURLMap.get(str.toLowerCase());
		if (val) {
			str = val;
		} else if (!/^https?:\/\//i.test(str)) {
			str = (isLoopback("http://" + str) ? "http://" : "https://") + str;
		}
	}
	str = trimTrailingSlashes(str);
	let api: string;
	try {
		const info = await discoveryJson(`${str}/.well-known/spacebar`);
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
		const info = await discoveryJson(
			`${api}${url.pathname.includes("api") ? "" : "api"}/policies/instance/domains`,
		);
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
		const credentials = credentialsFor(url, init, apiDoms, cookieModeHosts);
		if (credentials !== undefined && init?.credentials === undefined) {
			init = {...init, credentials};
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
