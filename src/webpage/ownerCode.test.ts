import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Dialog, Form} = await import("./settings");
const {I18n} = await import("./i18n");

const API = "http://owner.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

type SubForm = {submit(): Promise<void>; names: Map<string, {value: string}>};

/** Opens application "a1"'s manage form for an owner with two-factor on, and returns the
 * button callbacks it added (by label) and the sub-forms they open. */
async function manageApp(app: object) {
	await I18n.done;
	captureRequests(API + "/applications/a1", () => Response.json(app));
	const buttons = new Map<string, () => unknown>();
	vi.spyOn(Form.prototype, "addButtonInput").mockImplementation(function (
		this: InstanceType<typeof Form>,
		_label: string,
		text: string,
		onClick: () => void,
	) {
		buttons.set(text, onClick);
		return undefined as never;
	});
	const subForms: SubForm[] = [];
	const addSubForm = Form.prototype.addSubForm;
	vi.spyOn(Form.prototype, "addSubForm").mockImplementation(function (
		this: InstanceType<typeof Form>,
		...args: Parameters<typeof addSubForm>
	) {
		const sub = addSubForm.apply(this, args);
		subForms.push(sub as unknown as SubForm);
		return sub;
	});
	const user = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API},
		headers: {Authorization: "t"},
		mfa_enabled: true,
		// `perminfo` reads the account's stored info.
		userinfo: {localuserStore: {applications: {}}},
		botTokens: new Map(),
		userMap: new Map(),
		guilds: [],
	});
	return {user, buttons, subForms};
}

it("deleting an application sends the owner's two-factor code", async () => {
	const sent = captureRequests(
		API + "/applications/a1/delete",
		() => new Response(null, {status: 204}),
	);
	const {user, buttons, subForms} = await manageApp({id: "a1", name: "App", bot: null});
	await user.manageApplication("a1", new Dialog("").options, () => {});

	buttons.get(I18n.applications.delete())!();
	const sub = subForms.at(-1)!;
	sub.names.get("code")!.value = "123456";
	await sub.submit();

	expect(sent).toEqual([{code: "123456"}]);
});

it("resetting a bot's token sends the owner's two-factor code and shows the new token", async () => {
	const sent = captureRequests(API + "/applications/a1/bot/reset", () =>
		Response.json({token: "new-token"}),
	);
	const {user, buttons, subForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: {id: "1553128617381273639", username: "bot", discriminator: "0", avatar: null},
	});
	await user.manageBot("a1", new Dialog("").options as never);

	await buttons.get(I18n.localuser.resetToken())!();
	const sub = subForms.at(-1)!;
	sub.names.get("code")!.value = "654321";
	await sub.submit();

	expect(sent).toEqual([{code: "654321"}]);
	expect(user.botTokens.get("a1")).toBe("new-token");
});

it("a refused token reset keeps the token it had", async () => {
	captureRequests(API + "/applications/a1/bot/reset", () =>
		Response.json({code: 60008, message: "Invalid two-factor code"}, {status: 400}),
	);
	const {user, buttons, subForms} = await manageApp({
		id: "a1",
		name: "App",
		bot: {id: "1553128617381273639", username: "bot", discriminator: "0", avatar: null},
	});
	await user.manageBot("a1", new Dialog("").options as never);

	await buttons.get(I18n.localuser.resetToken())!();
	const sub = subForms.at(-1)!;
	sub.names.get("code")!.value = "000000";
	await sub.submit();

	expect(user.botTokens.has("a1")).toBe(false);
});
