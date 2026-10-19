import {afterEach, expect, it} from "vitest";
import {page} from "vitest/browser";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {InteractionModal} = await import("./modal");
const {I18n} = await import("../i18n");
await I18n.done;

// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("../public/style.css?inline");
document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);

afterEach(async () => {
	document.querySelectorAll(".interactionModal").forEach((m) => m.closest(".background")?.remove());
	await page.viewport(1280, 800);
});

/** A bot's form taller than a phone's screen with the keyboard up: three long fields. */
function tallModal() {
	const paragraph = (custom_id: string) => ({
		type: 18,
		label: custom_id,
		component: {type: 4, custom_id, style: 2, required: false},
	});
	return {
		id: "1100",
		nonce: "42",
		channel_id: "200",
		custom_id: "row9",
		title: "Row 9",
		application: {id: "300", name: "Responder", icon: null},
		components: [
			{type: 10, content: "Some words about the form.\n\nAnd some more."},
			paragraph("first"),
			paragraph("second"),
			paragraph("third"),
			{
				type: 18,
				label: "Select",
				component: {type: 3, custom_id: "pick", options: [{label: "A", value: "a"}]},
			},
		],
	};
}

/** The phone with its keyboard up: the viewport is what's left above the keyboard. */
async function phoneWithKeyboard() {
	await page.viewport(400, 420);
	const root = new InteractionModal(
		tallModal() as never,
		{
			api: "http://modal.test/api/v9",
			headers: {},
			sessionId: "s",
		} as never,
	).show();
	return {root, frame: root.closest<HTMLElement>(".dialogModal")!};
}

it("on a phone a bot's form is one sheet the size of the space above the keyboard", async () => {
	const {root, frame} = await phoneWithKeyboard();
	const box = frame.getBoundingClientRect();

	expect(Math.round(box.top)).toBe(0);
	expect(Math.round(box.height)).toBe(420);
	expect(Math.round(box.width)).toBe(400);
	// The form itself runs edge to edge: no gutter between the sheet and the form.
	const form = root.getBoundingClientRect();
	expect(Math.round(form.left)).toBe(0);
	expect(Math.round(form.width)).toBe(400);
});

it("on a phone the form scrolls in one place, and Submit stays on screen", async () => {
	const {root, frame} = await phoneWithKeyboard();
	const body = root.querySelector<HTMLElement>(".interactionModalBody")!;
	const submit = root.querySelector<HTMLElement>(".interactionModalSubmit")!;

	// No second scrolling frame around the form.
	expect(frame.scrollHeight).toBeLessThanOrEqual(frame.clientHeight);
	expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight);
	expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
	expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(420);
});

// A guard on the wide-screen dialog, which stays a centred card.
it("on a wide screen the form stays a centred card", async () => {
	const root = new InteractionModal(tallModal() as never, {api: "", headers: {}} as never).show();
	const box = root.closest<HTMLElement>(".dialogModal")!.getBoundingClientRect();

	expect(box.width).toBeLessThanOrEqual(500);
	expect(box.top).toBeGreaterThan(0);
});
