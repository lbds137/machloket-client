import {beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before the select.
await import("../localuser");
const {FancySelect} = await import("./fancySelect");
await (
	await import("../i18n")
).I18n.done;

const options = () => [
	{label: "alpha", value: "a", default: false},
	{label: "beta", value: "b", default: false},
	{label: "gamma", value: "c", default: false},
];

/** Mounts a select, opens its list (focus), and returns handles for driving it. */
function mount(select: InstanceType<typeof FancySelect>) {
	const root = select.getHTML();
	document.body.append(root);
	const input = root.querySelector("input")!;
	input.focus();
	const option = (label: string) =>
		[...root.querySelectorAll<HTMLElement>(".fancyOptions > div")].find((row) =>
			row.textContent?.includes(label),
		)!;
	// A tap: Android Chrome fires the compatibility mousedown after touchend.
	const tap = (label: string) =>
		option(label).dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));
	const close = () => input.blur();
	const error = () => root.querySelector(".fancySelectError")?.textContent ?? "";
	return {root, input, tap, close, error};
}

beforeEach(() => {
	document.querySelectorAll(".fancySelect").forEach((select) => select.remove());
});

describe("FancySelect, single choice", () => {
	it("sends the picked value on the tap, once", () => {
		const select = new FancySelect(options());
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {input, tap, close} = mount(select);

		tap("beta");
		close();

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(["b"]);
		expect(input.placeholder).toBe("beta");
		expect(input.value).toBe("");
	});

	it("offers no clear button on the chosen option, since clearing wouldn't reach the bot", () => {
		// A message whose bot set a default: its chip renders when the select is built.
		const chosen = options().map((option) => ({...option, default: option.value === "b"}));
		const {root} = mount(new FancySelect(chosen));

		expect(root.querySelector("input")!.placeholder).toBe("beta");
		expect(root.querySelector(".svg-x")).toBeNull();
	});

	it("replaces an earlier pick instead of adding to it", () => {
		const select = new FancySelect(options());
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {tap} = mount(select);

		tap("beta");
		tap("gamma");

		expect(onSubmit).toHaveBeenLastCalledWith(["c"]);
	});
});

describe("FancySelect, multiple choice", () => {
	it("sends the chosen values when the list closes", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {tap, close} = mount(select);

		tap("alpha");
		tap("gamma");
		expect(onSubmit).not.toHaveBeenCalled();
		close();

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(["a", "c"]);
	});

	it("sends nothing when the list closes unchanged", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {close} = mount(select);

		close();

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("says why instead of sending when too few are chosen", () => {
		const select = new FancySelect(options(), {min: 2, max: 3});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {tap, close, error} = mount(select);

		tap("alpha");
		close();

		expect(onSubmit).not.toHaveBeenCalled();
		expect(error()).not.toBe("");
	});

	it("says why when a tap would go past the maximum", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const {tap, error} = mount(select);

		tap("alpha");
		tap("beta");
		tap("gamma");

		expect(error()).not.toBe("");

		tap("beta");

		expect(error()).toBe("");
	});

	it("still sends on Enter", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {input, tap} = mount(select);

		tap("beta");
		input.dispatchEvent(new KeyboardEvent("keypress", {key: "Enter"}));

		expect(onSubmit).toHaveBeenCalledWith(["b"]);
	});
});

it("shows an option's icon, not its object", () => {
	const icon = document.createElement("img");
	icon.className = "optionIcon";
	const select = new FancySelect([{label: "alpha", value: "a", default: false, icon}]);
	const {root} = mount(select);

	expect(root.querySelector(".optionIcon")).not.toBeNull();
	expect(root.textContent).not.toContain("[object Object]");
});
