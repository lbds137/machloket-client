import {I18n} from "../i18n.js";
import {MarkDown} from "../markdown.js";
import {Dialog} from "../settings.js";
import {removeAni} from "../utils/utils.js";
import type {Channel} from "../channel.js";
import type {Localuser} from "../localuser.js";

// Discord-style application modals: a bot answers an interaction with a modal (callback type
// 9), the gateway delivers INTERACTION_MODAL_CREATE, and the user's answers go back as a
// modal-submit interaction (type 5). Field rules mirror the server's
// (spacebar-server src/api/util/handlers/InteractionModalFields.ts), so problems show here
// before anything is sent.

const enum Type {
	ActionRow = 1,
	StringSelect = 3,
	TextInput = 4,
	TextDisplay = 10,
	Label = 18,
	FileUpload = 19,
	RadioGroup = 21,
	CheckboxGroup = 22,
	Checkbox = 23,
}

type Option = {label: string; value: string; description?: string; default?: boolean};
type FieldDef = {
	type: number;
	id?: number;
	custom_id: string;
	required?: boolean;
	// text input
	style?: number;
	label?: string;
	placeholder?: string;
	min_length?: number;
	max_length?: number;
	value?: string;
	// selects and groups
	options?: Option[];
	min_values?: number;
	max_values?: number;
	// checkbox
	default?: boolean;
};
type TopLevel =
	| {type: Type.TextDisplay; id?: number; content: string}
	| {type: Type.Label; id?: number; label: string; description?: string; component: FieldDef}
	| {type: Type.ActionRow; id?: number; components: FieldDef[]};

export type ModalCreateEvent = {
	id: string;
	nonce?: string;
	channel_id: string;
	custom_id: string;
	title: string;
	components: unknown[];
	application: {id: string; name: string; icon?: string | null};
};

/** What a modal needs from the logged-in session; see `modalHost` in localuser.ts. */
export type ModalHost = {
	api: string;
	headers: Record<string, string>;
	sessionId?: string;
	guildId?: string;
	/** The message whose component opened the modal; undefined when a slash command did. */
	openerMessageId?: string;
	/** Renders prose (TextDisplay) with the channel's mentions and emoji. */
	markdownOwner?: Localuser | Channel;
	/** Called with the submit's nonce, so the bot's answer (or its failure) can be shown. */
	trackSubmit?: (nonce: string) => void;
};

type Submit = {
	type: number;
	id?: number;
	custom_id: string;
	value?: string | boolean | null;
	values?: string[];
};

/** One answerable field: its input elements, its rule check, and its submit entry. */
type Field = {
	element: HTMLElement;
	error: HTMLElement;
	/** The rule it breaks, if any. */
	problem(): string | undefined;
	submit(): Submit;
};

const base = (def: FieldDef) => ({
	type: def.type,
	...(def.id !== undefined ? {id: def.id} : {}),
	custom_id: def.custom_id,
});

function textField(def: FieldDef, submitForm: () => void): Field {
	const input =
		def.style === 2 ? document.createElement("textarea") : document.createElement("input");
	if (input instanceof HTMLInputElement) {
		// Enter in a one-line field sends the form, as Discord's does.
		input.onkeydown = (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				submitForm();
			}
		};
	}
	input.classList.add("interactionModalInput");
	input.dataset.customId = def.custom_id;
	input.value = def.value ?? "";
	if (def.placeholder) input.placeholder = def.placeholder;
	const max = def.max_length ?? 4000;
	input.maxLength = max;
	const min = def.min_length ?? 0;
	const required = def.required !== false;
	return {
		element: input,
		error: document.createElement("div"),
		problem() {
			const length = input.value.length;
			if (!length) return required ? I18n.interactions.modalRequired() : undefined;
			if (length < min || length > max) return I18n.interactions.modalLength(min + "", max + "");
			return undefined;
		},
		submit: () => ({...base(def), value: input.value}),
	};
}

/** Checked values in option order, for a select, a radio group or a checkbox group. */
function choiceField(def: FieldDef, kind: "select" | "radio" | "checkbox"): Field {
	const options = def.options ?? [];
	const required = def.required !== false;
	const [min, max] =
		kind === "radio"
			? [1, 1]
			: [def.min_values ?? 1, def.max_values ?? (kind === "select" ? 1 : options.length)];
	let chosen: () => string[];
	let element: HTMLElement;
	if (kind === "select") {
		const select = document.createElement("select");
		select.classList.add("interactionModalInput");
		select.dataset.customId = def.custom_id;
		select.multiple = max > 1;
		if (!select.multiple) {
			// Lets a single select start (or go back to) empty, as Discord's does.
			const none = document.createElement("option");
			none.value = "";
			none.textContent = def.placeholder ?? "";
			select.append(none);
		}
		for (const option of options) {
			const element = document.createElement("option");
			element.value = option.value;
			element.textContent = option.label;
			element.selected = !!option.default;
			select.append(element);
		}
		chosen = () => [...select.selectedOptions].map((o) => o.value).filter((v) => v !== "");
		element = select;
	} else {
		const group = document.createElement("div");
		group.classList.add("interactionModalChoices");
		group.dataset.customId = def.custom_id;
		const name = "modal-" + def.custom_id + "-" + Math.random().toString(36).slice(2);
		for (const option of options) {
			const row = document.createElement("label");
			row.classList.add("interactionModalChoice");
			const input = document.createElement("input");
			input.type = kind;
			input.name = name;
			input.value = option.value;
			input.checked = !!option.default;
			const text = document.createElement("span");
			text.textContent = option.label;
			row.append(input, text);
			if (option.description) {
				const description = document.createElement("small");
				description.textContent = option.description;
				row.append(description);
			}
			group.append(row);
		}
		chosen = () =>
			[...group.querySelectorAll<HTMLInputElement>("input")]
				.filter((i) => i.checked)
				.map((i) => i.value);
		element = group;
	}
	return {
		element,
		error: document.createElement("div"),
		problem() {
			const count = chosen().length;
			// An optional field may stay empty, and then skips the count bounds (as the server does).
			if (!count) return required ? I18n.interactions.modalRequired() : undefined;
			if (count < min || count > max) return I18n.interactions.modalCount(min + "", max + "");
			return undefined;
		},
		submit() {
			const values = chosen();
			if (kind === "radio") return {...base(def), value: values[0] ?? null};
			return {...base(def), values};
		},
	};
}

function checkboxField(def: FieldDef): Field {
	const input = document.createElement("input");
	input.type = "checkbox";
	input.classList.add("interactionModalCheckbox");
	input.dataset.customId = def.custom_id;
	input.checked = !!def.default;
	return {
		element: input,
		error: document.createElement("div"),
		problem: () => undefined,
		submit: () => ({...base(def), value: input.checked}),
	};
}

function fieldFor(def: FieldDef, submitForm: () => void): Field | undefined {
	switch (def.type) {
		case Type.TextInput:
			return textField(def, submitForm);
		case Type.StringSelect:
			return choiceField(def, "select");
		case Type.RadioGroup:
			return choiceField(def, "radio");
		case Type.CheckboxGroup:
			return choiceField(def, "checkbox");
		case Type.Checkbox:
			return checkboxField(def);
		default:
			// FileUpload (19) and the user/role/mentionable/channel selects (5-8) are not built yet.
			return undefined;
	}
}

export class InteractionModal {
	private readonly event: ModalCreateEvent;
	private readonly host: ModalHost;
	/** Per top-level component, in order: how to produce its submit entry. */
	private readonly entries: (() => object)[] = [];
	private readonly fields: Field[] = [];
	/** Top-level index → the fields under it, for mapping the server's errors back. */
	private readonly fieldsAt = new Map<number, Field[]>();
	private readonly formError = document.createElement("div");
	private readonly submitButton = document.createElement("button");
	private dialog?: Dialog;
	private unsupported = false;
	private sending = false;

	constructor(event: ModalCreateEvent, host: ModalHost) {
		this.event = event;
		this.host = host;
	}

	/** Opens the modal and returns its root element. */
	show(): HTMLElement {
		const root = document.createElement("div");
		root.classList.add("interactionModal", "flexttb");

		const header = document.createElement("div");
		header.classList.add("interactionModalHeader");
		const app = document.createElement("div");
		app.classList.add("interactionModalApp");
		app.textContent = this.event.application.name;
		const title = document.createElement("h2");
		title.classList.add("interactionModalTitle");
		title.textContent = this.event.title;
		header.append(app, title);

		const body = document.createElement("div");
		body.classList.add("interactionModalBody", "flexttb");
		this.event.components.forEach((component, index) => {
			body.append(this.renderTopLevel(component as TopLevel, index));
		});

		this.formError.classList.add("interactionModalFormError");
		const footer = document.createElement("div");
		footer.classList.add("interactionModalFooter", "flexltr");
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.classList.add("interactionModalCancel");
		cancel.textContent = I18n.cancel();
		cancel.onclick = () => void this.close();
		this.submitButton.type = "button";
		this.submitButton.classList.add("interactionModalSubmit");
		this.submitButton.textContent = I18n.submit();
		this.submitButton.onclick = () => void this.submit();
		footer.append(cancel, this.submitButton);

		root.append(header, body, this.formError, footer);
		if (this.unsupported) {
			this.formError.textContent = I18n.interactions.modalUnsupported();
			this.submitButton.disabled = true;
		}
		this.dialog = new Dialog("");
		this.dialog.options.addHTMLArea(root);
		this.dialog.show();
		// A tap outside would throw away typed answers (easy on a phone); Escape and Cancel close it.
		const background = this.dialog.background.deref();
		if (background) background.onclick = null;
		root.querySelector<HTMLElement>(".interactionModalBody :is(input, textarea, select)")?.focus();
		return root;
	}

	private renderTopLevel(component: TopLevel, index: number): HTMLElement {
		const wrap = document.createElement("div");
		if (component.type === Type.TextDisplay) {
			wrap.classList.add("interactionModalText");
			wrap.append(new MarkDown(component.content, this.host.markdownOwner).makeHTML());
			this.entries.push(() => ({type: Type.TextDisplay, ...idOf(component)}));
			return wrap;
		}
		if (component.type === Type.Label) {
			const field = this.renderField(component.component, component.label, component.description);
			wrap.append(field.wrap);
			this.fieldsAt.set(index, field.field ? [field.field] : []);
			const answer = field.field;
			this.entries.push(() => ({
				type: Type.Label,
				...idOf(component),
				...(answer ? {component: answer.submit()} : {}),
			}));
			return wrap;
		}
		if (component.type === Type.ActionRow) {
			// The legacy shape: an action row of text inputs, each carrying its own label.
			const rowFields: Field[] = [];
			for (const def of component.components ?? []) {
				const field = this.renderField(def, def.label ?? "");
				wrap.append(field.wrap);
				if (field.field) rowFields.push(field.field);
			}
			this.fieldsAt.set(index, rowFields);
			this.entries.push(() => ({
				type: Type.ActionRow,
				...idOf(component),
				components: rowFields.map((field) => field.submit()),
			}));
			return wrap;
		}
		this.markUnsupported(wrap, (component as {type: number}).type);
		return wrap;
	}

	private renderField(def: FieldDef, label: string, description?: string) {
		const wrap = document.createElement("div");
		wrap.classList.add("interactionModalField", "flexttb");
		const field = fieldFor(def, () => void this.submit());
		const labelElement = document.createElement("label");
		labelElement.classList.add("interactionModalLabel");
		labelElement.textContent = label;
		if (field && def.required !== false && def.type !== Type.Checkbox) {
			labelElement.classList.add("interactionModalRequired");
		}
		if (field && def.type === Type.Checkbox) {
			// A single checkbox reads as "[x] Label", like Discord's.
			const row = document.createElement("label");
			row.classList.add("interactionModalChoice");
			const text = document.createElement("span");
			text.classList.add("interactionModalLabel");
			text.textContent = label;
			row.append(field.element, text);
			wrap.append(row);
		} else {
			wrap.append(labelElement);
		}
		if (description) {
			const descriptionElement = document.createElement("div");
			descriptionElement.classList.add("interactionModalDescription");
			descriptionElement.textContent = description;
			wrap.append(descriptionElement);
		}
		if (!field) {
			this.markUnsupported(wrap, def.type);
			return {wrap, field};
		}
		if (def.type !== Type.Checkbox) {
			if (
				field.element instanceof HTMLInputElement ||
				field.element instanceof HTMLTextAreaElement ||
				field.element instanceof HTMLSelectElement
			) {
				field.element.id = "modal-field-" + Math.random().toString(36).slice(2);
				labelElement.htmlFor = field.element.id;
			}
			wrap.append(field.element);
		}
		field.error.classList.add("interactionModalError");
		wrap.append(field.error);
		this.fields.push(field);
		return {wrap, field};
	}

	/** A field this client can't answer: the whole modal can't be submitted correctly. */
	private markUnsupported(wrap: HTMLElement, type: number) {
		const note = document.createElement("div");
		note.classList.add("interactionModalError");
		note.textContent = I18n.interactions.notImpl(type + "");
		wrap.append(note);
		this.unsupported = true;
	}

	/** Checks every field, sends the answers, and closes on success. Resolves whether it was accepted. */
	async submit(): Promise<boolean> {
		// Enter and the Submit button both land here; the server takes one answer per modal.
		if (this.unsupported || this.sending) return false;
		let ok = true;
		for (const field of this.fields) {
			const problem = field.problem();
			field.error.textContent = problem ?? "";
			if (problem) ok = false;
		}
		this.formError.textContent = "";
		if (!ok) return false;

		this.sending = true;
		this.submitButton.disabled = true;
		try {
			const body: Record<string, unknown> = {
				type: 5,
				nonce: Math.floor(Math.random() * 10 ** 9) + "",
				application_id: this.event.application.id,
				channel_id: this.event.channel_id,
				guild_id: this.host.guildId,
				session_id: this.host.sessionId,
				data: {
					id: this.event.id,
					custom_id: this.event.custom_id,
					components: this.entries.map((entry) => entry()),
				},
			};
			// The server checks this against the opener's message: none when a slash command opened it.
			if (this.host.openerMessageId) body.message_id = this.host.openerMessageId;
			this.host.trackSubmit?.(body.nonce as string);
			const response = await fetch(this.host.api + "/interactions", {
				method: "POST",
				headers: this.host.headers,
				body: JSON.stringify(body),
			});
			if (response.ok) {
				await this.close();
				return true;
			}
			this.showServerErrors(await response.json().catch(() => ({})));
			return false;
		} catch (e) {
			this.formError.textContent = I18n.interactions.failed() + ": " + (e as Error).message;
			return false;
		} finally {
			this.sending = false;
			this.submitButton.disabled = false;
		}
	}

	/**
	 * The server's field errors under their fields. Spacebar sends flat dotted keys
	 * (`data.components.<i>[.components.<j>]…`); Discord nests the same path as objects.
	 */
	private showServerErrors(body: {message?: string; errors?: unknown}) {
		this.formError.textContent = body.message ?? I18n.interactions.failed();
		for (const [path, errors] of errorPaths(body.errors)) {
			const match = path.match(/^data\.components\.(\d+)(?:\.components\.(\d+))?/);
			const message = firstErrorMessage(errors);
			if (!match || !message) continue;
			const fields = this.fieldsAt.get(Number(match[1]));
			const field = fields?.[match[2] === undefined ? 0 : Number(match[2])];
			if (field) field.error.textContent = message;
		}
	}

	async close() {
		const background = this.dialog?.background.deref();
		if (background) await removeAni(background);
	}
}

function idOf(component: {id?: number}) {
	return component.id !== undefined ? {id: component.id} : {};
}

/** Every `[dotted path, error node]` in an error body, flat keys and nested objects alike. */
function errorPaths(errors: unknown, prefix = ""): [string, unknown][] {
	if (!errors || typeof errors !== "object") return [];
	const out: [string, unknown][] = [];
	for (const [key, value] of Object.entries(errors)) {
		if (key === "_errors") continue;
		const path = prefix ? prefix + "." + key : key;
		if ((value as {_errors?: unknown})?._errors) out.push([path, value]);
		else out.push(...errorPaths(value, path));
	}
	return out;
}

function firstErrorMessage(errors: unknown): string | undefined {
	if (!errors || typeof errors !== "object") return undefined;
	const list = (errors as {_errors?: {message?: string}[]})._errors;
	if (list?.length) return list[0].message;
	for (const value of Object.values(errors)) {
		const message = firstErrorMessage(value);
		if (message) return message;
	}
	return undefined;
}
