// Character limits are documented, not screenshot-dependent: Discord docs (resources/poll,
// Poll Media object) — "The maximum length of text is 300 for the question, and 55 for any
// answer". The answer-count bounds match Discord's modal UI; re-check those two in the
// screenshot pass.
export const QUESTION_MAX_CHARS = 300;
export const ANSWER_MAX_CHARS = 55;
export const MIN_ANSWERS = 2;
export const MAX_ANSWERS = 10;

export function validatePoll(question: string, answers: string[]): string[] {
	const refusals: string[] = [];
	if (question.trim().length === 0) {
		refusals.push("poll.emptyQuestion");
	}
	if (answers.some((answer) => answer.trim().length === 0)) {
		refusals.push("poll.emptyAnswer");
	}
	if (question.length > QUESTION_MAX_CHARS) {
		refusals.push("poll.questionTooLong");
	}
	if (answers.some((answer) => answer.length > ANSWER_MAX_CHARS)) {
		refusals.push("poll.answerTooLong");
	}
	if (answers.length < MIN_ANSWERS) {
		refusals.push("poll.minAnswers");
	}
	if (answers.length > MAX_ANSWERS) {
		refusals.push("poll.maxAnswers");
	}
	return refusals;
}
