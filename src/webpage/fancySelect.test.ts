import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before the select.
await import("./localuser");
const {FancySelect} = await import("./utils/fancySelect");
const {I18n} = await import("./i18n");
await I18n.done;

/** The value the static starts with in this browser, restored after every test. */
const phoneModeAtStart = FancySelect.phoneMode;

const options = () => [
	{label: "alpha", value: "a", default: false},
	{label: "beta", value: "b", default: false},
	{label: "gamma", value: "c", default: false},
];

/** The options with one bot-chosen default, for sheets that open with a selection. */
const chosenOptions = (value: string) =>
	options().map((option) => ({...option, default: option.value === value}));

/** Mounts a select and returns handles for driving its phone sheet. */
function mount(select: InstanceType<typeof FancySelect>) {
	const root = select.getHTML();
	document.body.append(root);
	const input = root.querySelector("input")!;
	const sheet = () => document.querySelector<HTMLElement>(".selectSheetBackdrop");
	const row = (label: string) =>
		[...document.querySelectorAll<HTMLElement>(".selectSheetRow")].find((candidate) =>
			candidate.textContent?.includes(label),
		)!;
	return {
		root,
		input,
		/** The tap on the select's box: the event the sheet opens from. */
		open: () =>
			input.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, cancelable: true})),
		tapRow: (label: string) => {
			// A faithful row tap: the pointerdown (which disarms the open gesture's
			// click swallow) and then the click the row answers.
			const target = row(label);
			target.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
			target.click();
		},
		row,
		sheet,
		count: () => document.querySelector(".selectSheetCount")?.textContent ?? "",
		apply: () => document.querySelector<HTMLButtonElement>(".selectSheetApply")!,
		checked: (label: string) =>
			row(label).querySelector<HTMLInputElement>("input[type=checkbox]")!.checked,
		closeByBackdrop: () => sheet()!.click(),
	};
}

afterEach(() => {
	FancySelect.phoneMode = phoneModeAtStart;
	document
		.querySelectorAll(".fancySelect, .selectSheetBackdrop")
		.forEach((elm: Element) => elm.remove());
});

describe("FancySelect phone sheet", () => {
	beforeEach(() => {
		FancySelect.phoneMode = true;
	});

	it("opens the sheet from the box without focusing the input", () => {
		const select = new FancySelect(options());
		const {input, open, sheet} = mount(select);

		open();

		expect(sheet()).not.toBeNull();
		expect(document.activeElement).not.toBe(input);
	});

	it("discards unsent picks when the backdrop closes the sheet", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow, closeByBackdrop, checked} = mount(select);

		open();
		tapRow("alpha");
		closeByBackdrop();
		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();

		open();
		expect(checked("alpha")).toBe(false);
	});

	it("counts picks and submits only on Apply", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow, count, apply} = mount(select);

		open();
		tapRow("alpha");
		expect(count()).toBe("1 selected");
		tapRow("gamma");
		expect(count()).toBe("2 selected");
		expect(onSubmit).not.toHaveBeenCalled();

		apply().click();

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(["a", "c"]);
		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
	});

	it("disables unselected rows at the maximum instead of erroring", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const {open, tapRow, row, count} = mount(select);

		open();
		tapRow("alpha");
		tapRow("beta");
		expect(row("gamma").classList.contains("selectSheetDisabled")).toBe(true);

		tapRow("gamma");
		expect(count()).toBe("2 selected");

		tapRow("beta");
		expect(row("gamma").classList.contains("selectSheetDisabled")).toBe(false);
		tapRow("gamma");
		expect(count()).toBe("2 selected");
	});

	it("keeps Apply disabled until the minimum is reached", () => {
		const select = new FancySelect(options(), {min: 2, max: 3});
		const {open, tapRow, apply} = mount(select);

		open();
		expect(apply().disabled).toBe(true);

		tapRow("alpha");
		expect(apply().disabled).toBe(true);

		tapRow("beta");
		expect(apply().disabled).toBe(false);
	});

	it("answers a single select on the row tap", () => {
		const select = new FancySelect(options());
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow} = mount(select);

		open();
		tapRow("beta");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(["b"]);
		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
	});

	it("ignores the opening tap's own trailing click", () => {
		// The sheet opens on the box tap's pointerdown, so the same gesture's release
		// lands on whatever row the sheet slid under. In the e2e run that click
		// silently picked "Releases" at open (count read "1 selected" untouched);
		// the swallow must eat it, and a tap that starts a new gesture must answer.
		const select = new FancySelect(options(), {min: 1, max: 2});
		const {open, row, count} = mount(select);

		open();
		row("alpha").click();
		expect(count()).toBe("0 selected");

		row("alpha").dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
		row("alpha").click();
		expect(count()).toBe("1 selected");
	});

	it("lets a keyboard or assistive-tech activation through after the opening tap", () => {
		// A keydown starts a new gesture with no pointerdown: it must disarm the swallow,
		// or the activation's click would be eaten.
		const select = new FancySelect(options(), {min: 1, max: 2});
		const {open, row, count} = mount(select);

		open();
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
		row("alpha").click();
		expect(count()).toBe("1 selected");
	});

	it("keeps the sheet open when the opening tap's click lands on the backdrop", () => {
		// The release over the dimmed backdrop would discard the sheet the tap just opened.
		const select = new FancySelect(options(), {min: 1, max: 2});
		const {open} = mount(select);

		open();
		(document.querySelector(".selectSheetBackdrop") as HTMLElement).click();
		expect(document.querySelector(".selectSheetBackdrop")).not.toBeNull();
	});

	it("does not answer a single select with the opening tap's click", () => {
		// A single select answers and closes on a row tap, so the phantom click would send.
		const select = new FancySelect(options());
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, row} = mount(select);

		open();
		row("beta").click();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(document.querySelector(".selectSheetBackdrop")).not.toBeNull();
	});

	it("clears a chip without opening the sheet", () => {
		// A message whose bot chose "alpha": its chip renders with a × when the select is built.
		const chosen = options().map((option) => ({...option, default: option.value === "a"}));
		const select = new FancySelect(chosen, {min: 1, max: 2});
		const {root, input, sheet} = mount(select);
		const x = root.querySelector<HTMLElement>(".selected .svg-x")!;

		x.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));

		expect(sheet()).toBeNull();
		expect(root.querySelector(".selected")).toBeNull();

		// Reopening is the box's own tap, not a side effect of the clear.
		input.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, cancelable: true}));
		expect(sheet()).not.toBeNull();
	});

	it("opens the sheet from a real focus and leaves the keyboard shut", () => {
		// A tap's focus can't be reproduced synthetically (the pointerdown is preventDefaulted),
		// so the focus path itself must not leave the input under the sheet's keyboard.
		const select = new FancySelect(options());
		const {input, sheet} = mount(select);

		input.focus();

		expect(sheet()).not.toBeNull();
		expect(document.activeElement).not.toBe(input);
	});

	it("restores a pre-chosen value when the backdrop discards", () => {
		const select = new FancySelect(chosenOptions("a"), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow, closeByBackdrop, checked} = mount(select);

		open();
		tapRow("beta");
		tapRow("alpha");
		closeByBackdrop();

		open();
		expect(checked("alpha")).toBe(true);
		expect(checked("beta")).toBe(false);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("closes with discard from the header ×", () => {
		const select = new FancySelect(chosenOptions("a"), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow, checked} = mount(select);

		open();
		const x = document.querySelector<HTMLElement>(".selectSheetClose")!;
		tapRow("beta");
		tapRow("alpha");
		x.click();

		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();

		open();
		expect(checked("alpha")).toBe(true);
		expect(checked("beta")).toBe(false);
	});

	it("closes with discard on Escape and drops its key listener", () => {
		const select = new FancySelect(chosenOptions("a"), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {open, tapRow, checked} = mount(select);

		open();
		tapRow("beta");
		tapRow("alpha");
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();

		// A stray Escape afterwards finds no listener: no error, no state change, no sheet.
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		expect(document.querySelector(".selectSheetBackdrop")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();

		open();
		expect(checked("alpha")).toBe(true);
		expect(checked("beta")).toBe(false);
	});
});

describe("FancySelect desktop guard (phoneMode off)", () => {
	beforeEach(() => {
		FancySelect.phoneMode = false;
	});

	it("opens the inline list on focus, not a sheet", () => {
		const select = new FancySelect(options());
		const {root, input, sheet} = mount(select);

		input.focus();

		expect(root.querySelector(".fancyOptions")).not.toBeNull();
		expect(sheet()).toBeNull();
	});

	it("still submits the change when the list closes", () => {
		const select = new FancySelect(options(), {min: 1, max: 2});
		const onSubmit = vi.fn();
		select.onSubmit = onSubmit;
		const {root, input} = mount(select);
		input.focus();
		const alpha = [...root.querySelectorAll<HTMLElement>(".fancyOptions > div")].find((candidate) =>
			candidate.textContent?.includes("alpha"),
		)!;
		alpha.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));

		input.blur();

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith(["a"]);
	});
});
