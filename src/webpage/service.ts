import {messageFrom, messageTo} from "./utils/serviceType";

function deleteoldcache() {
	caches.delete("cache");
	console.log("this ran :P");
}

async function putInCache(request: URL | RequestInfo, response: Response) {
	console.log(request, response);
	const cache = await caches.open("cache");
	console.log("Grabbed");
	try {
		console.log(await cache.put(request, response));
	} catch (error) {
		console.error(error);
	}
}

let lastcache: string;
self.addEventListener("activate", async () => {
	console.log("Service Worker activated");
	checkCache();
});
async function tryToClose() {
	const portArr = [...ports];
	if (portArr.length) {
		for (let i = 1; i < portArr.length; i++) {
			portArr[i].postMessage({code: "closing"});
		}
		portArr[0].postMessage({code: "close"});
	} else {
		throw new Error("No Fermi clients connected?");
	}
}
function sendAll(message: messageFrom) {
	for (const port of ports) {
		port.postMessage(message);
	}
}
async function checkCache() {
	if (checkedrecently) {
		return false;
	}
	const promise = await caches.match("/getupdates");
	if (promise) {
		lastcache = await promise.text();
	}
	console.log(lastcache);
	return fetch("/getupdates").then(async (data) => {
		setTimeout(
			(_: any) => {
				checkedrecently = false;
			},
			1000 * 60 * 30,
		);
		if (!data.ok) return false;
		const text = await data.clone().text();
		console.log(text, lastcache);
		if (lastcache !== text) {
			deleteoldcache();
			putInCache("/getupdates", data);
			tryToClose();
			checkedrecently = true;
			sendAll({
				code: "updates",
				updates: true,
			});
			return true;
		}
		checkedrecently = true;
		return false;
	});
}
var checkedrecently = false;

function samedomain(url: string | URL) {
	return new URL(url).origin === self.origin;
}

let enabled = "false";
let offline = false;
function toPathNoDefault(url: string) {
	const Url = new URL(url);
	let html: string | undefined = undefined;
	const path = Url.pathname;
	if (path.startsWith("/channels")) {
		html = "./app";
	} else if (path.startsWith("/invite/") || path === "/invite") {
		html = "./invite";
	} else if (path.startsWith("/template/") || path === "/template") {
		html = "./template";
	} else if (path === "/") {
		html = "./index";
	}
	return html;
}
function toPath(url: string): string {
	const Url = new URL(url);
	return toPathNoDefault(url) || Url.pathname;
}
let fails = 0;
async function getfile(event: FetchEvent): Promise<Response> {
	checkCache();
	if (
		!samedomain(event.request.url) ||
		enabled === "false" ||
		(enabled === "offlineOnly" && !offline)
	) {
		const responce = await fetch(event.request.clone());
		if (samedomain(event.request.url)) {
			if (enabled === "offlineOnly" && responce.ok) {
				putInCache(toPath(event.request.url), responce.clone());
			}
			if (!responce.ok) {
				fails++;
				if (fails > 5) {
					offline = true;
				}
			}
		}
		return responce;
	}

	let path = toPath(event.request.url);
	if (path === "/instances.json") {
		return await fetch(path);
	}
	console.log("Getting path: " + path);
	const responseFromCache = await caches.match(path);
	if (responseFromCache) {
		console.log("cache hit");
		return responseFromCache;
	}
	try {
		const responseFromNetwork = await fetch(path);
		if (responseFromNetwork.ok) {
			await putInCache(path, responseFromNetwork.clone());
		}
		return responseFromNetwork;
	} catch (e) {
		console.error(e);
		return new Response(null);
	}
}

self.addEventListener("fetch", (e) => {
	const event = e as FetchEvent;
	if (event.request.method === "POST") {
		return;
	}
	if (new URL(event.request.url).pathname.startsWith("/api/")) {
		return;
	}
	try {
		event.respondWith(getfile(event));
	} catch (e) {
		console.error(e);
	}
});
const ports = new Set<MessagePort>();
function listenToPort(port: MessagePort) {
	function sendMessage(message: messageFrom) {
		port.postMessage(message);
	}
	port.onmessage = async (e) => {
		const data = e.data as messageTo;
		switch (data.code) {
			case "ping": {
				sendMessage({
					code: "pong",
					count: ports.size,
				});
				break;
			}
			case "close": {
				ports.delete(port);
				break;
			}
			case "replace": {
				//@ts-ignore-error Just the type or wrong or something
				self.skipWaiting();
				break;
			}
			case "CheckUpdate": {
				checkedrecently = false;
				if (!(await checkCache())) {
					sendMessage({
						code: "updates",
						updates: false,
					});
				}

				break;
			}
			case "isValid": {
				sendMessage({code: "isValid", url: data.url, valid: !!toPathNoDefault(data.url)});
			}
		}
	};
	port.addEventListener("close", () => {
		ports.delete(port);
	});
}
self.addEventListener("message", (message) => {
	const data = message.data;
	switch (data.code) {
		case "setMode":
			enabled = data.data;
			break;
		case "ForceClear":
			deleteoldcache();
			break;
		case "port": {
			const port = data.port as MessagePort;
			ports.add(port);
			listenToPort(port);
		}
	}
});
