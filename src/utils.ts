import {Request, Response} from "express";
import {instace} from "./index.js";
interface ApiUrls {
	api: string;
	gateway: string;
	cdn: string;
	wellknown: string;
}

interface Invite {
	guild: {
		name: string;
		description?: string;
		icon?: string;
		id: string;
	};
	inviter?: {
		username: string;
	};
}

export async function getApiUrls(
	url: string,
	instances: instace[],
	check = true,
): Promise<ApiUrls | null> {
	if (!url.endsWith("/")) {
		url += "/";
	}
	if (check) {
		let valid = false;
		for (const instace of instances) {
			const urlstr = instace.url || instace.urls?.api;
			if (!urlstr) {
				continue;
			}
			try {
				if (new URL(urlstr).host === new URL(url).host) {
					valid = true;
					break;
				}
			} catch (e) {
				//console.log(e);
			}
		}
		if (!valid) {
			throw new Error("Invalid instance");
		}
	}
	try {
		const info: ApiUrls = await fetch(`${url}.well-known/spacebar`).then((res) => res.json());
		const api = info.api;
		const apiUrl = new URL(api);
		const policies: any = await fetch(
			`${api}${apiUrl.pathname.includes("api") ? "" : "api"}/policies/instance/domains`,
		).then((res) => res.json());
		return {
			api: policies.apiEndpoint,
			gateway: policies.gateway,
			cdn: policies.cdn,
			wellknown: url,
		};
	} catch (error) {
		console.error("Error fetching API URLs:", error);
		return null;
	}
}
