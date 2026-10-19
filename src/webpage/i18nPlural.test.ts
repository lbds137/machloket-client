import {afterEach, describe, expect, it} from "vitest";

await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(async () => {
	await I18n.create("en");
});

describe("PLURAL", () => {
	// Czech classes its counts as 1 / 2-4 / 0-and-5+ — 12-14 included in the rest (Intl:
	// PluralRules("cs").select(22) is "other", unlike Polish where 22 is "few"). A
	// three-alternative block needs the language's rule, not the positional one.
	it("a three-alternative block follows Czech's plural classes", () => {
		I18n.lang = "cs";
		const noun = "$1 {{PLURAL:$1|člen|členy|členů}}";
		expect(I18n.fillInBlanks(noun, ["1"])).toBe("1 člen");
		expect(I18n.fillInBlanks(noun, ["2"])).toBe("2 členy");
		expect(I18n.fillInBlanks(noun, ["3"])).toBe("3 členy");
		expect(I18n.fillInBlanks(noun, ["4"])).toBe("4 členy");
		expect(I18n.fillInBlanks(noun, ["5"])).toBe("5 členů");
		expect(I18n.fillInBlanks(noun, ["12"])).toBe("12 členů");
		expect(I18n.fillInBlanks(noun, ["22"])).toBe("22 členů");
		expect(I18n.fillInBlanks(noun, ["24"])).toBe("24 členů");
		expect(I18n.fillInBlanks(noun, ["32"])).toBe("32 členů");
		expect(I18n.fillInBlanks(noun, ["102"])).toBe("102 členů");
		expect(I18n.fillInBlanks(noun, ["0"])).toBe("0 členů");
		// Fractional counts take the "rest" alternative (Intl gives "many" for 1.5).
		expect(I18n.fillInBlanks(noun, ["1.5"])).toBe("1.5 členů");
	});

	// pl and ru ship one|few|many blocks (MediaWiki order) and class 22 as "few", unlike Czech.
	it("a three-alternative block follows Polish and Russian plural classes", () => {
		I18n.lang = "pl";
		const pl = "$1 {{PLURAL:$1|gildia|gildie|gildii}}";
		expect(I18n.fillInBlanks(pl, ["1"])).toBe("1 gildia");
		expect(I18n.fillInBlanks(pl, ["3"])).toBe("3 gildie");
		expect(I18n.fillInBlanks(pl, ["5"])).toBe("5 gildii");
		expect(I18n.fillInBlanks(pl, ["12"])).toBe("12 gildii");
		expect(I18n.fillInBlanks(pl, ["22"])).toBe("22 gildie");
		I18n.lang = "ru";
		const ru = "$1 {{PLURAL:$1|запись|записи|записей}}";
		expect(I18n.fillInBlanks(ru, ["1"])).toBe("1 запись");
		expect(I18n.fillInBlanks(ru, ["3"])).toBe("3 записи");
		expect(I18n.fillInBlanks(ru, ["11"])).toBe("11 записей");
		expect(I18n.fillInBlanks(ru, ["21"])).toBe("21 запись");
		expect(I18n.fillInBlanks(ru, ["25"])).toBe("25 записей");
		// Russian fractions (Intl "other") take the genitive singular, the middle form.
		expect(I18n.fillInBlanks(ru, ["1.5"])).toBe("1.5 записи");
	});

	it("the shipped Russian blocked-messages and typing lines agree with their counts", async () => {
		await I18n.create("ru");
		expect(I18n.showBlockedMessages("1")).toContain("просмотреть 1 заблокированное сообщение.");
		expect(I18n.showBlockedMessages("2")).toContain("просмотреть 2 заблокированных сообщения.");
		expect(I18n.showBlockedMessages("5")).toContain("просмотреть 5 заблокированных сообщений.");
		expect(I18n.typing("1", "Аня")).toBe("Аня печатает");
		expect(I18n.typing("2", "Аня, Боря")).toBe("Аня, Боря печатают");
	});

	it("the shipped Irish discovery title and message count read as words", async () => {
		await I18n.create("ga");
		expect(I18n.guild.disoveryTitle("1")).toBe("Fionnachtain na Guild (1 iontráil)");
		expect(I18n.guild.disoveryTitle("3")).toBe("Fionnachtain na Guild (3 iontrálacha)");
		expect(I18n.message.messages("1")).toBe("1 teachtaireacht >");
		expect(I18n.message.messages("4")).toBe("4 teachtaireachtaí >");
	});

	it("a two-alternative block keeps the positional fallback for every language", () => {
		I18n.lang = "en";
		expect(I18n.fillInBlanks("$1 {{PLURAL:$1|member|members}}", ["1"])).toBe("1 member");
		expect(I18n.fillInBlanks("$1 {{PLURAL:$1|member|members}}", ["2"])).toBe("2 members");
		expect(I18n.fillInBlanks("$1 {{PLURAL:$1|member|members}}", ["0"])).toBe("0 members");
		I18n.lang = "cs";
		// Two slots cannot express Czech's three classes; the old mapping stands.
		expect(I18n.fillInBlanks("$1 {{PLURAL:$1|člen|členů}}", ["2"])).toBe("2 členů");
	});
});
