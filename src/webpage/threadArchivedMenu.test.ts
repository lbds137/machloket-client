import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

/** The labels of a thread's context menu, as it renders for that thread's state. */
function menuLabels(state: {member?: object; threadData?: {archived: boolean}}) {
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "t1",
		type: 11,
		headers: {},
		owner: {info: {api: "http://thread-menu.test"}, localuser: {user: {id: "u1"}}},
		hasPermission: () => false,
		...state,
	}) as InstanceType<typeof Channel>;
	const menu = document.createElement("div");
	for (const part of Channel.contextmenu.buttons) {
		part.makeContextHTML(channel, undefined, menu, [], new WeakSet());
	}
	return Array.from(menu.querySelectorAll("button")).map((b) => b.textContent);
}

// The server refuses both with 50083 while the thread is archived; a send unarchives it.
it("an archived thread offers neither Leave nor Join", () => {
	const archived = {archived: true};
	expect(menuLabels({member: {}, threadData: archived})).not.toContain(I18n.threads.leave());
	expect(menuLabels({threadData: archived})).not.toContain(I18n.threads.join());
});

it("an open thread offers Leave to a member and Join to anyone else", () => {
	const open = {archived: false};
	expect(menuLabels({member: {}, threadData: open})).toContain(I18n.threads.leave());
	expect(menuLabels({threadData: open})).toContain(I18n.threads.join());
	// A thread with no metadata isn't archived.
	expect(menuLabels({member: {}})).toContain(I18n.threads.leave());
});
