import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const emptyRef = {deref: () => undefined} as unknown as WeakRef<HTMLDivElement>;

it("an Options whose container was collected still opens a sub-form", () => {
	const options = new Dialog("").options;
	options.container = emptyRef;

	let form;
	expect(() => {
		form = options.addSubForm("Sub", () => {});
	}).not.toThrow();
	expect(options.subOptions).toBe(form);
});

it("a sub-form opened after the container was collected has working controls", () => {
	const options = new Dialog("").options;
	options.container = emptyRef;

	const form = options.addSubForm("Sub", () => {});
	const checkbox = form.addCheckboxInput("label", "name", {initState: false});
	expect(() => checkbox.setState(true)).not.toThrow();
	expect(checkbox.value).toBe(true);

	const html = options.generateHTML();
	expect(html.textContent).toContain("Sub");
});

it("a rendered Options opens its sub-form in the page it rendered, not off-page", () => {
	const options = new Dialog("").options;
	const html = options.generateHTML();
	document.body.append(html);
	try {
		const container = options.container.deref();
		expect(container?.isConnected).toBe(true);

		const form = options.addSubForm("Sub", () => {});

		// The sub-form's name goes in the title, outside the container; its body is its own
		// Options' container, which must land inside the page's container.
		const formBody = form.options.container.deref();
		expect(formBody?.isConnected).toBe(true);
		expect(container?.contains(formBody!)).toBe(true);
	} finally {
		html.remove();
	}
});

it("an Options rendered and then dropped still opens a sub-form", () => {
	const options = new Dialog("").options;
	options.generateHTML();
	options.container = emptyRef;

	expect(() => {
		options.addSubForm("Sub", () => {});
	}).not.toThrow();
});
