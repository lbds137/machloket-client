import {expect, it} from "vitest";
import {captureRequests} from "../test/setup";

await import("../localuser");
const {fetchMessageLimit} = await import("./messageLimit");

const API = "http://limit.test/api/v9";
const CONFIG = API + "/policies/instance/config";

it("reads the instance's limit", async () => {
	captureRequests(CONFIG, () => Response.json({limits_message_maxCharacters: 4000}));
	expect(await fetchMessageLimit(API)).toBe(4000);
});

it.each([
	["an instance without the route", () => new Response("<html>", {status: 404})],
	["an HTML answer", () => new Response("<html>", {status: 200})],
	["no such field", () => Response.json({})],
	["a string", () => Response.json({limits_message_maxCharacters: "4000"})],
	["zero", () => Response.json({limits_message_maxCharacters: 0})],
	["a fraction", () => Response.json({limits_message_maxCharacters: 1.5})],
	["offline", () => Promise.reject(new TypeError("Failed to fetch"))],
])("knows no limit from %s", async (_name, answer) => {
	captureRequests(CONFIG, answer);
	expect(await fetchMessageLimit(API)).toBeUndefined();
});
