export const CSRF_HEADER = "X-Machloket-CSRF";

export type AccountAuth = {
	readonly uid: string;
	readonly token?: string;
	readonly authMode?: "cookie";
	/** The account's own API base (`…/api/v9`). The 401 probe goes only there. */
	readonly serverurls?: {readonly api: string};
};

export type AccountHeaders = {
	"Content-type"?: string;
	Authorization?: string;
	"X-Machloket-CSRF"?: "1";
};

/** Each tagged headers object -> the account object it was built from. The object, not its uid:
 * the 401 probe must read the credential of the very instance that built the headers (READY
 * refreshes that one), never another live copy of the same uid that holds an older token. */
const builtFor = new WeakMap<object, AccountAuth>();

// Filled from discovery's authCookie by TASK-149; empty until then.
export const cookieModeHosts = new Set<string>();

export function applyAccountHeaders(target: AccountHeaders, account: AccountAuth): void {
	if (account.authMode === "cookie") {
		delete target.Authorization;
		target[CSRF_HEADER] = "1";
	} else {
		delete target[CSRF_HEADER];
		target.Authorization = account.token;
	}
	builtFor.set(target, account);
}

export function buildAccountHeaders(account: AccountAuth, opts?: {json?: boolean}): AccountHeaders {
	const headers: AccountHeaders = {};
	if (opts?.json ?? true) {
		headers["Content-type"] = "application/json; charset=UTF-8";
	}
	applyAccountHeaders(headers, account);
	return headers;
}

/** A copy of `base` carrying its account tag. `json: false` drops every content type, whatever
 * its case (fetch joins a `Content-type` and a `Content-Type`, and the server refuses that);
 * `extra` applies after the drop, so it may set its own. */
export function deriveHeaders<T extends Record<string, string | undefined>>(
	base: T,
	opts: {extra?: Record<string, string>; json?: boolean},
): T {
	const copy: Record<string, string | undefined> = {...base};
	if (opts.json === false) {
		for (const name of Object.keys(copy)) {
			if (name.toLowerCase() === "content-type") delete copy[name];
		}
	}
	Object.assign(copy, opts.extra);
	const account = builtFor.get(base);
	if (account !== undefined) builtFor.set(copy, account);
	return copy as T;
}

/** The account a request's headers were built from, or undefined (bots, pre-auth, raw requests). */
export function accountOf(init?: RequestInit): AccountAuth | undefined {
	const headers = init?.headers;
	if (!headers || typeof headers !== "object") return undefined;
	return builtFor.get(headers);
}

export function accountUidOf(init?: RequestInit): string | undefined {
	return accountOf(init)?.uid;
}

export function readHeader(headers: HeadersInit | undefined, name: string): string | null {
	if (!headers) return null;
	if (headers instanceof Headers) return headers.get(name);
	const target = name.toLowerCase();
	if (Array.isArray(headers)) {
		const found = headers.find(([k]) => k.toLowerCase() === target);
		return found ? found[1] : null;
	}
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === target && typeof v === "string") return v;
	}
	return null;
}

export function setXhrAccountHeaders(xhr: XMLHttpRequest, headers: AccountHeaders): void {
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === "content-type" || typeof v !== "string") continue;
		xhr.setRequestHeader(k, v);
	}
	if (headers[CSRF_HEADER] === "1") {
		xhr.withCredentials = true;
	}
}

export function credentialsFor(
	url: URL,
	init: RequestInit | undefined,
	apiHosts: ReadonlySet<string>,
	cookieModeHosts: ReadonlySet<string>,
): RequestCredentials | undefined {
	if (init?.credentials !== undefined) return init.credentials;
	if (readHeader(init?.headers, CSRF_HEADER) === "1") return "include";
	if (cookieModeHosts.has(url.host)) return undefined;
	if (apiHosts.has(url.host)) return "include";
	return undefined;
}
