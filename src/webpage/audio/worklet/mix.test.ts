import {expect, it, vi} from "vitest";
import {Track} from "./track";
import {AVoice} from "./voice";
import {BinRead} from "../../utils/binaryUtils";

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
