import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {formatTime} = await import("./message");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const realToLocaleDateString = Date.prototype.toLocaleDateString;

/** A browser whose dates read day first (dd/mm/yyyy, or dd.mm.yyyy), as most of the world's do. */
function dayFirstDates(separator: string) {
	vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date) {
		return realToLocaleDateString
			.call(this, "en-GB", {day: "2-digit", month: "2-digit", year: "numeric"})
			.replaceAll("/", separator);
	});
}

const clock = (date: Date) => date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});

// Days of the month above 12 where it matters, so a day-first date can't pass for a
// month-first one; then the month and year turning over.
it.each([
	["slashes", "/", new Date(2031, 9, 18, 15, 0)],
	["dots", ".", new Date(2031, 9, 21, 15, 0)],
	["slashes, on the first of a month", "/", new Date(2031, 9, 1, 15, 0)],
	["dots, on New Year's Day", ".", new Date(2032, 0, 1, 15, 0)],
])("a message from yesterday says so with day-first dates (%s)", (_, separator, today) => {
	dayFirstDates(separator);
	vi.useFakeTimers({toFake: ["Date"], now: today});
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 14, 5);

	expect(formatTime(yesterday)).toBe(I18n.yesterdayAt(clock(yesterday)));
});

// The old cache only moved forward, so a clock set back a day kept the later "today".
it("a message from today says so after the clock moved back", () => {
	vi.useFakeTimers({toFake: ["Date"], now: new Date(2031, 9, 18, 15, 0)});
	formatTime(new Date(2031, 9, 18, 9, 0));
	vi.setSystemTime(new Date(2031, 9, 17, 15, 0));
	const earlier = new Date(2031, 9, 17, 9, 0);

	expect(formatTime(earlier)).toBe(I18n.todayAt(clock(earlier)));
});
