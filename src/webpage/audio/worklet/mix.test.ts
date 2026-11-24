import {expect, it, vi} from "vitest";
import {Track} from "./track";
import {AVoice} from "./voice";
import {BinRead, BinWrite} from "../../utils/binaryUtils";

it("two sounds playing at once add up, not double the first", () => {
	const a = new AVoice(() => 0, 440);
	const b = new AVoice(() => 0, 440);
	vi.spyOn(a, "getNumber").mockReturnValue(0.25);
	vi.spyOn(b, "getNumber").mockReturnValue(0.25);

	expect(new Track([a, b]).getNumber(0)).toBe(0.5);
});

it("a sound file's formula can raise a negative number to a power", () => {
	// (-5) ** 2, as the sound editor writes it: op 9 (power), then two constants (op 0).
	const view = new DataView(new ArrayBuffer(11));
	view.setUint8(0, 9);
	view.setUint8(1, 0);
	view.setFloat32(2, -5);
	view.setUint8(6, 0);
	view.setFloat32(7, 2);

	expect(AVoice.parseExpression(new BinRead(view.buffer))(0, 0)).toBe(25);
});

// A formula as the sound editor writes it (audio/page.ts): a prefix tree of one-byte ops, a
// constant being op 0 followed by its float32.
type Formula = number | "t" | "f" | "pi" | FormulaOp;
interface FormulaOp extends Array<Formula> {
	0: number;
}
function encode(formula: Formula, w = new BinWrite(256)): BinWrite {
	if (typeof formula === "number") {
		w.write8(0);
		w.write32Float(formula);
	} else if (formula === "t") w.write8(1);
	else if (formula === "f") w.write8(2);
	else if (formula === "pi") w.write8(3);
	else {
		w.write8(formula[0]);
		for (const operand of formula.slice(1)) encode(operand, w);
	}
	return w;
}
const formula = (f: Formula) => AVoice.parseExpression(new BinRead(encode(f).getBuffer()));

it("a sound file's formula computes every op, operands in written order", () => {
	const t = 1.75;
	const f = 3;
	const cases: [Formula, number][] = [
		[2.5, 2.5],
		["t", t],
		["f", f],
		["pi", Math.PI],
		[[4, "t"], Math.sin(t)],
		[[5, "t", "f"], t * f],
		[[6, "t", "f"], t + f],
		[[7, "t", "f"], t / f],
		[[8, "t", "f"], t - f],
		[[9, "t", "f"], t ** f],
		[[10, "f", "t"], f % t],
		[[11, -4], 4],
		[[12, 2.75], 3],
		[[13, "t"], Math.cos(t)],
		// The sound editor's own "custom" voice.
		[
			[4, [5, [9, [6, "t", 2], [13, [5, "t", 4]]], [5, [5, "pi", 2], "f"]]],
			Math.sin((t + 2) ** Math.cos(t * 4) * (Math.PI * 2 * f)),
		],
	];
	for (const [written, expected] of cases) {
		expect(formula(written)(t, f), JSON.stringify(written)).toBeCloseTo(expected, 12);
	}
});

it("a parsed formula is read once and can be evaluated again", () => {
	const wave = formula([8, "t", "f"]);
	expect(wave(5, 2)).toBe(3);
	expect(wave(5, 2)).toBe(3);
	expect(wave(1, 4)).toBe(-3);
});

it("a formula with an unknown op is refused while it is read", () => {
	expect(() => formula([14, "t"])).toThrow("unexpected case found!");
});

it("a formula never compiles code (the Content-Security-Policy refuses eval)", () => {
	const realFunction = globalThis.Function;
	globalThis.Function = function () {
		throw new EvalError("code compiled from a string");
	} as unknown as FunctionConstructor;
	try {
		expect(formula([6, "t", 1])(2, 0)).toBe(3);
	} finally {
		globalThis.Function = realFunction;
	}
});
