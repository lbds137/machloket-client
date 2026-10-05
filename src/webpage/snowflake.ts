abstract class SnowFlake {
	public readonly id: string;
	constructor(id: string) {
		this.id = id;
	}
	getUnixTime(): number {
		return SnowFlake.stringToUnixTime(this.id);
	}
	static stringToUnixTime(str: string) {
		try {
			return Number((BigInt(str) >> 22n) + 1420070400000n);
		} catch {
			throw new Error(
				`The ID is corrupted, it's ${JSON.stringify(str)} when it should be some number.`,
			);
		}
	}
	static DateToID(date: Date) {
		return ((BigInt(+date) - 1420070400000n) << 22n).toString();
	}
	/** Orders ids oldest first, exactly (ids pass 2^53, so Number() rounds them). An id that
	 * isn't a number (a pending send's) is newer than any that is. */
	static compareIds(a: string, b: string): number {
		const real = /^\d+$/;
		if (!real.test(a) || !real.test(b)) return +!real.test(a) - +!real.test(b);
		const diff = BigInt(a) - BigInt(b);
		return diff > 0n ? 1 : diff < 0n ? -1 : 0;
	}
}
export {SnowFlake};
