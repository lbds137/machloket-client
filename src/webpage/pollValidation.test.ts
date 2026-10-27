import {beforeEach, describe, expect, it, vi} from "vitest";
import {
	ANSWER_MAX_CHARS,
	MAX_ANSWERS,
	MIN_ANSWERS,
	QUESTION_MAX_CHARS,
	validatePoll,
} from "./utils/pollValidation";

const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

describe("validatePoll", () => {
	it("exports the tunable poll limits", () => {
		expect(QUESTION_MAX_CHARS).toBe(300);
		expect(ANSWER_MAX_CHARS).toBe(32);
		expect(MIN_ANSWERS).toBe(2);
		expect(MAX_ANSWERS).toBe(10);
	});

	it("rejects an empty or whitespace-only question and accepts a non-empty question", () => {
		expect(validatePoll("Lunch?", ["Yes", "No"])).toEqual([]);
		expect(validatePoll("", ["Yes", "No"])).toEqual(["poll.emptyQuestion"]);
		expect(validatePoll("   ", ["Yes", "No"])).toEqual(["poll.emptyQuestion"]);
	});

	it("accepts a question at QUESTION_MAX_CHARS and rejects one char over", () => {
		expect(validatePoll("q".repeat(QUESTION_MAX_CHARS), ["Yes", "No"])).toEqual([]);
		expect(validatePoll("q".repeat(QUESTION_MAX_CHARS + 1), ["Yes", "No"])).toEqual([
			"poll.questionTooLong",
		]);
	});

	it("rejects when any answer is empty or whitespace-only", () => {
		expect(validatePoll("Lunch?", ["", "No"])).toEqual(["poll.emptyAnswer"]);
		expect(validatePoll("Lunch?", ["Yes", ""])).toEqual(["poll.emptyAnswer"]);
		expect(validatePoll("Lunch?", ["Yes", "   "])).toEqual(["poll.emptyAnswer"]);
	});

	it("accepts an answer at ANSWER_MAX_CHARS and rejects one char over", () => {
		expect(validatePoll("Lunch?", ["a".repeat(ANSWER_MAX_CHARS), "No"])).toEqual([]);
		expect(validatePoll("Lunch?", ["a".repeat(ANSWER_MAX_CHARS + 1), "No"])).toEqual([
			"poll.answerTooLong",
		]);
	});

	it("accepts MIN_ANSWERS answers and rejects fewer than MIN_ANSWERS", () => {
		const atMin = Array.from({length: MIN_ANSWERS}, (_, i) => `Option ${i + 1}`);
		const belowMin = Array.from({length: MIN_ANSWERS - 1}, (_, i) => `Option ${i + 1}`);
		expect(validatePoll("Lunch?", atMin)).toEqual([]);
		expect(validatePoll("Lunch?", belowMin)).toEqual(["poll.minAnswers"]);
		expect(validatePoll("Lunch?", [])).toEqual(["poll.minAnswers"]);
	});

	it("accepts MAX_ANSWERS answers and rejects more than MAX_ANSWERS", () => {
		const atMax = Array.from({length: MAX_ANSWERS}, (_, i) => `Option ${i + 1}`);
		const overMax = Array.from({length: MAX_ANSWERS + 1}, (_, i) => `Option ${i + 1}`);
		expect(validatePoll("Lunch?", atMax)).toEqual([]);
		expect(validatePoll("Lunch?", overMax)).toEqual(["poll.maxAnswers"]);
	});

	it("returns refusal keys for every violated rule at once", () => {
		expect(validatePoll("", ["", ""])).toEqual(["poll.emptyQuestion", "poll.emptyAnswer"]);
		const overMaxWithBadAnswer = [
			"a".repeat(ANSWER_MAX_CHARS + 1),
			...Array.from({length: MAX_ANSWERS}, (_, i) => `Option ${i + 1}`),
		];
		expect(validatePoll("q".repeat(QUESTION_MAX_CHARS + 1), overMaxWithBadAnswer)).toEqual([
			"poll.questionTooLong",
			"poll.answerTooLong",
			"poll.maxAnswers",
		]);
	});
});

describe("makePoll modal wiring", () => {
	beforeEach(() => {
		document.querySelectorAll(".dialogModal").forEach((el) => el.closest(".background")?.remove());
	});

	it("clamps rows between MIN and MAX, caps field lengths live, and gates submit on validatePoll", () => {
		const sendMessage = vi.fn();
		Localuser.prototype.makePoll.call({channelfocus: {sendMessage}});

		const modal = document.querySelector<HTMLElement>(".dialogModal")!;
		expect(modal).not.toBeNull();

		const questionInput = modal.querySelector<HTMLInputElement>(
			".optionElement input[type='text']",
		)!;
		const ansInputs = () => [...modal.querySelectorAll<HTMLInputElement>(".pollAnsM input")];
		const delButtons = () => [...modal.querySelectorAll<HTMLElement>(".pollAnsM .svg-delete")];
		const buttons = [...modal.querySelectorAll<HTMLButtonElement>("button")];
		const newAnswerBtn = buttons.find((b) => b.textContent === I18n.poll.newAnswer())!;
		const submitBtn = buttons.find((b) => b.textContent === I18n.submit())!;
		const status = modal.querySelector<HTMLElement>(".pollStatus")!;
		const maxHint = modal.querySelector<HTMLElement>(".pollMaxHint")!;

		// Pristine state: submit disabled after d.show() re-generates buttonHtml, delete disabled at MIN.
		expect(submitBtn.disabled).toBe(true);
		expect(status.textContent).toBe(I18n.poll.emptyQuestion());
		expect(ansInputs()).toHaveLength(MIN_ANSWERS);
		expect(delButtons().every((d) => d.getAttribute("aria-disabled") === "true")).toBe(true);

		// Clicking delete at MIN does not splice below 2 rows.
		delButtons()[0].click();
		expect(ansInputs()).toHaveLength(MIN_ANSWERS);

		// Filling question + 2 answers enables submit and clears status.
		questionInput.value = "Best snack?";
		questionInput.dispatchEvent(new Event("input"));
		expect(submitBtn.disabled).toBe(true);
		expect(status.textContent).toBe(I18n.poll.emptyAnswer());

		ansInputs()[0].value = "Pretzels";
		ansInputs()[0].dispatchEvent(new Event("input"));
		expect(submitBtn.disabled).toBe(true);

		ansInputs()[1].value = "Apples";
		ansInputs()[1].dispatchEvent(new Event("input"));
		expect(submitBtn.disabled).toBe(false);
		expect(status.textContent).toBe("");

		// Live char caps on question and answer inputs.
		questionInput.value = "q".repeat(QUESTION_MAX_CHARS + 25);
		questionInput.dispatchEvent(new Event("input"));
		expect(questionInput.value).toHaveLength(QUESTION_MAX_CHARS);

		ansInputs()[0].value = "a".repeat(ANSWER_MAX_CHARS + 10);
		ansInputs()[0].dispatchEvent(new Event("input"));
		expect(ansInputs()[0].value).toHaveLength(ANSWER_MAX_CHARS);

		// Add up to MAX_ANSWERS clamps New Answer and shows the maxAnswers hint.
		for (let i = MIN_ANSWERS; i < MAX_ANSWERS; i++) {
			expect(newAnswerBtn.disabled).toBe(false);
			newAnswerBtn.click();
		}
		expect(ansInputs()).toHaveLength(MAX_ANSWERS);
		expect(newAnswerBtn.disabled).toBe(true);
		expect(maxHint.textContent).toBe(I18n.poll.maxAnswers());
		expect(delButtons()[0].getAttribute("aria-disabled")).toBe("false");

		// Delete back down to MIN_ANSWERS and submit.
		for (let i = MAX_ANSWERS; i > MIN_ANSWERS; i--) {
			delButtons()[i - 1].click();
		}
		expect(ansInputs()).toHaveLength(MIN_ANSWERS);
		expect(newAnswerBtn.disabled).toBe(false);
		expect(submitBtn.disabled).toBe(false);

		submitBtn.click();
		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith("", {
			poll: {
				question: {text: "q".repeat(QUESTION_MAX_CHARS)},
				answers: [
					{poll_media: {text: "a".repeat(ANSWER_MAX_CHARS)}},
					{poll_media: {text: "Apples"}},
				],
				duration: 24,
				allow_multiselect: false,
			},
		});
	});
});
