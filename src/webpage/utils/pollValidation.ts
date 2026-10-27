// TUNABLE: Discord-truth pending screenshot pass
export const QUESTION_MAX_CHARS = 300;
// TUNABLE: Discord-truth pending screenshot pass
export const ANSWER_MAX_CHARS = 32;
// TUNABLE: Discord-truth pending screenshot pass
export const MIN_ANSWERS = 2;
// TUNABLE: Discord-truth pending screenshot pass
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
