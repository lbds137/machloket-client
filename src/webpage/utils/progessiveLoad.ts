/** A streamed load the server answered without a usable body: `response` is that answer (a
 * refusal's status and reason), unread. Under an idle budget its body is already in memory
 * (empty if it stalled), so reading it cannot hang. */
export class ProgressiveLoadError extends Error {
	constructor(readonly response: Response) {
		super("request not ok: HTTP " + response.status);
	}
}

/** The body ended cleanly where more was needed. */
export class EndOfBody extends Error {
	constructor() {
		super("ran out of file to read");
	}
}

export type ProgressiveOptions = {
	/** Aborts the load (with a TimeoutError) when the server sends nothing for this long. The
	 * clock runs only while the headers or a body chunk is awaited, never while the reader works
	 * between reads, so a long body that keeps arriving is never cut. Unset: no budget here. */
	idleTimeoutMs?: number;
};

export class ProgressiveArray<I extends RequestInit = RequestInit> {
	read?: ReadableStreamDefaultReader<Uint8Array>;
	controller: AbortController;
	cbuff?: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	index = 0;
	sizeLeft = 0;
	ready: Promise<void>;
	private idleTimeoutMs?: number;
	constructor(
		url: string,
		req: I = {} as I,
		fetcher: (input: string, init: I) => Promise<Response> = (input, init) => fetch(input, init),
		{idleTimeoutMs}: ProgressiveOptions = {},
	) {
		this.idleTimeoutMs = idleTimeoutMs;
		this.controller = new AbortController();
		this.ready = this.idle(
			fetcher(url, {
				...req,
				signal: this.controller.signal,
			}),
		).then(async (f) => {
			if (!f.ok || !f.body) {
				// Under a budget, the refusal's body is read here and handed over whole, so a
				// reader of the error never waits on a body that stalls. A refusal is one short
				// JSON line, so the budget covers its whole body rather than each chunk. Unbudgeted
				// loads (media) pass the answer on unread, as they always did.
				if (!this.idleTimeoutMs) throw new ProgressiveLoadError(f);
				// Its status text and headers go along (a 429's Retry-After). An empty body stays
				// null: a null-body status (304) refuses any other.
				const body = (await this.idle(f.text()).catch(() => "")) || null;
				throw new ProgressiveLoadError(
					new Response(body, {status: f.status, statusText: f.statusText, headers: f.headers}),
				);
			}
			const read = f.body.getReader();
			this.cbuff = (await this.idle(read.read())).value;
			this.read = read;
		});
	}
	/** Awaits `pending` from the server under the idle budget, when there is one. */
	private async idle<T>(pending: Promise<T>): Promise<T> {
		if (!this.idleTimeoutMs) return pending;
		const timer = setTimeout(
			() => this.controller.abort(new DOMException("offline", "TimeoutError")),
			this.idleTimeoutMs,
		);
		try {
			return await pending;
		} finally {
			clearTimeout(timer);
		}
	}
	async next() {
		return (await this.get8BitArray(1))[0];
	}
	async get8BitArray(size: number) {
		if (!this.read) throw new Error("not ready to read");
		this.sizeLeft -= size;
		const arr = new Uint8Array(size);
		let arri = 0;
		while (size > 0) {
			if (!this.cbuff) throw new EndOfBody();
			let itter = Math.min(size, this.cbuff.length - this.index);
			size -= itter;
			for (let i = 0; i < itter; i++, arri++, this.index++) {
				arr[arri] = this.cbuff[this.index];
			}

			if (size !== 0) {
				this.cbuff = (await this.idle(this.read.read())).value;
				this.index = 0;
			}
		}
		return arr;
	}
	decoder = new TextDecoder();
	backChar?: string;
	chars = "";
	curchar = 0;
	async getChar() {
		if (this.backChar) {
			const temp = this.backChar;
			delete this.backChar;
			return temp;
		}
		let char: string;
		if ((char = this.chars[this.curchar])) {
			this.curchar++;
			return char;
		}
		let chars = "";
		while (!chars) {
			const buflen = (this.cbuff?.length || 0) - this.index;
			chars = this.decoder.decode((await this.get8BitArray(buflen <= 0 ? 1 : buflen)).buffer, {
				stream: true,
			});
		}
		this.chars = chars;
		this.curchar = 1;
		return chars[0];
	}
	putBackChar(char: string) {
		this.backChar = char;
	}
	close() {
		try {
			this.controller.abort();
		} catch {
			//Ignore error when trying to close after it was closed
		}
	}
}

async function getNextNonWhiteSpace(prog: ProgressiveArray) {
	let char = " ";
	const whiteSpace = new Set("\n\t \r");
	while (whiteSpace.has(char)) {
		char = await prog.getChar();
	}
	return char;
}
/** Reads the next JSON value. A malformed token throws a SyntaxError (JSON.parse's own included),
 * so a caller can tell a server that sent the wrong thing from a load that died; a body that ends
 * mid-value (EndOfBody) reads as a dead load. */
async function identifyType(prog: ProgressiveArray) {
	let char = await getNextNonWhiteSpace(prog);
	switch (char) {
		case "-":
		case "0":
		case "1":
		case "2":
		case "3":
		case "4":
		case "5":
		case "6":
		case "7":
		case "8":
		case "9": {
			const validNumber = new Set("0123456789eE.+-");
			let build = "";
			do {
				build += char;
				try {
					char = await prog.getChar();
				} catch (error) {
					// The body ends right after the number: the number is whole, and `build` already
					// holds its last digit, so there is nothing to put back.
					if (error instanceof EndOfBody) return JSON.parse(build) as number;
					throw error;
				}
			} while (validNumber.has(char));
			prog.putBackChar(char);
			return JSON.parse(build) as number;
		}
		case '"':
			let build = "";
			do {
				build += char;
				if (char == "\\") {
					char = await prog.getChar();
					build += char;
				}
				char = await prog.getChar();
			} while (char !== '"');
			build += char;
			return JSON.parse(build) as string;
		case "t":
		case "f":
		case "n": {
			let build = char;
			while (build.match(/(^tr?u?$)|(^fa?l?s?$)|(^nu?l?$)/)) {
				char = await prog.getChar();
				build += char;
			}
			return JSON.parse(build) as boolean | null;
		}
		case "[":
			return await ArrayProgressive.make(prog);
		case "{":
			return await ObjectProgressive.make(prog);
		default:
			throw new SyntaxError("bad JSON");
	}
}
/**
 * A list being decoded. One reader at a time: await each `more()` / `getNext()` before the next
 * call, and read an item through to its end before asking for the one after it. The delimiter owed
 * after a handed-over item is read lazily, only when the caller asks for the next item or whether
 * there is one, so a finished item is never held back by the bytes that follow it.
 */
export class ArrayProgressive<T, X extends Array<T>> {
	prog: ProgressiveArray;
	done = false;
	/** Resolves (never rejects) once this list reads its closing `]`. */
	readonly finished: Promise<void>;
	private resolveFinished!: () => void;
	/** The delimiter owed after the last item handed over. `child` is that item when it is a
	 * container that is not yet done. */
	private owed?: {child?: ArrayProgressive<any, any> | ObjectProgressive<any>};
	/** The last settle of the owed delimiter; a failed one stays failed. */
	private settled: Promise<void> = Promise.resolve();
	private constructor(prog: ProgressiveArray) {
		this.prog = prog;
		this.finished = new Promise<void>((resolve) => (this.resolveFinished = resolve));
	}
	static async make(prog: ProgressiveArray) {
		const o = new ArrayProgressive(prog);
		await o.check();
		return o;
	}
	async check() {
		const lastChar = await getNextNonWhiteSpace(this.prog);
		if (lastChar === "]") {
			this.done = true;
			this.resolveFinished();
			return;
		} else {
			this.prog.putBackChar(lastChar);
		}
	}
	/** Reads the delimiter owed after the last item handed over, if there is one. */
	private settle(): Promise<void> {
		const owed = this.owed;
		if (owed) {
			delete this.owed;
			this.settled = (async () => {
				if (owed.child) await owed.child.finished;
				const lastChar = await getNextNonWhiteSpace(this.prog);
				if (lastChar === "]") {
					this.done = true;
					this.resolveFinished();
				} else if (lastChar !== ",") throw new SyntaxError("Bad JSON Object:" + lastChar);
			})();
		}
		return this.settled;
	}
	/**
	 * Whether another item follows. This reads the delimiter owed after the last item handed over,
	 * so a nested container item must be read to its end first, or this waits for it.
	 */
	async more(): Promise<boolean> {
		await this.settle();
		return !this.done;
	}
	async getNext(): Promise<Progressive<T>> {
		await this.settle();
		if (this.done) throw new Error("no more array");
		const ret = (await identifyType(this.prog)) as Progressive<T>;
		this.owed =
			(ret instanceof ArrayProgressive || ret instanceof ObjectProgressive) && !ret.done
				? {child: ret}
				: {};
		return ret;
	}
	async *[Symbol.asyncIterator]() {
		while (await this.more()) {
			yield await this.getNext();
		}
	}
	/**
	 * this only gets what's left, not everything
	 */
	async getWhole(): Promise<X> {
		const arr: T[] = [];
		while (await this.more()) {
			let t = await this.getNext();
			if (t instanceof ArrayProgressive) {
				t = await t.getWhole();
			}
			if (t instanceof ObjectProgressive) {
				t = await t.getWhole();
			}
			arr.push(t as T);
		}

		return arr as X;
	}
}
/** The same as ArrayProgressive, for an object's pairs; the reading contract is the same. */
export class ObjectProgressive<X extends Object> {
	prog: ProgressiveArray;
	done = false;
	/** Resolves (never rejects) once this object reads its closing `}`. */
	readonly finished: Promise<void>;
	private resolveFinished!: () => void;
	/** The delimiter owed after the last pair handed over. `child` is that pair's value when it is
	 * a container that is not yet done. */
	private owed?: {child?: ArrayProgressive<any, any> | ObjectProgressive<any>};
	/** The last settle of the owed delimiter; a failed one stays failed. */
	private settled: Promise<void> = Promise.resolve();
	private constructor(prog: ProgressiveArray) {
		this.prog = prog;
		this.finished = new Promise<void>((resolve) => (this.resolveFinished = resolve));
	}
	static async make(prog: ProgressiveArray) {
		const o = new ObjectProgressive(prog);
		await o.check();
		return o;
	}
	async check() {
		const lastChar = await getNextNonWhiteSpace(this.prog);
		if (lastChar === "}") {
			this.done = true;
			this.resolveFinished();
			return;
		} else {
			this.prog.putBackChar(lastChar);
		}
	}
	/** Reads the delimiter owed after the last pair handed over, if there is one. */
	private settle(): Promise<void> {
		const owed = this.owed;
		if (owed) {
			delete this.owed;
			this.settled = (async () => {
				if (owed.child) await owed.child.finished;
				const lastChar = await getNextNonWhiteSpace(this.prog);
				if (lastChar === "}") {
					this.done = true;
					this.resolveFinished();
				} else if (lastChar !== ",") throw new SyntaxError("Bad JSON Object:" + lastChar);
			})();
		}
		return this.settled;
	}
	/**
	 * Whether another pair follows. This reads the delimiter owed after the last pair handed over,
	 * so a nested container value must be read to its end first, or this waits for it.
	 */
	async more(): Promise<boolean> {
		await this.settle();
		return !this.done;
	}
	async getNextPair(): Promise<{[K in keyof X]: {key: K; value: Progressive<X[K]>}}[keyof X]> {
		await this.settle();
		if (this.done) throw new Error("no more object");
		const key = (await identifyType(this.prog)) as unknown;
		if (typeof key !== "string") {
			throw new SyntaxError("Bad key:" + key);
		}
		const nextChar = await getNextNonWhiteSpace(this.prog);
		if (nextChar !== ":") throw new SyntaxError("Bad JSON");
		const value = (await identifyType(this.prog)) as unknown;
		this.owed =
			(value instanceof ArrayProgressive || value instanceof ObjectProgressive) && !value.done
				? {child: value}
				: {};
		return {key, value} as any;
	}
	/**
	 * this only gets what's left, not everything
	 */
	async getWhole(): Promise<X> {
		const obj: Partial<X> = {};
		while (await this.more()) {
			let {key, value} = await this.getNextPair();
			if (value instanceof ArrayProgressive) {
				value = await value.getWhole();
			}
			if (value instanceof ObjectProgressive) {
				value = await value.getWhole();
			}
			obj[key] = value as any;
		}
		return obj as X;
	}
}
Object.entries;
type Progressive<T> =
	T extends Array<any>
		? ArrayProgressive<T extends Array<infer X> ? X : never, T>
		: T extends string | boolean | null | number
			? T
			: T extends Object
				? ObjectProgressive<T>
				: T;
/*
 * this will progressively load a JSON object, you must read each item through to its end before asking for the next one.
 */
export async function ProgessiveDecodeJSON<X, I extends RequestInit = RequestInit>(
	url: string,
	req: I = {} as I,
	fetcher: (input: string, init: I) => Promise<Response> = (input, init) => fetch(input, init),
	options: ProgressiveOptions = {},
): Promise<Progressive<X>> {
	const prog = new ProgressiveArray(url, req, fetcher, options);
	try {
		try {
			await prog.ready;
		} catch (error) {
			// A 2xx with no body (a 204, or a 200 with a null body) is not a refusal: it is an
			// unreadable answer.
			if (error instanceof ProgressiveLoadError && error.response.ok)
				throw new SyntaxError("no body: HTTP " + error.response.status);
			throw error;
		}
		try {
			prog.putBackChar(await getNextNonWhiteSpace(prog));
		} catch (error) {
			if (error instanceof EndOfBody) throw new SyntaxError("empty body");
			throw error;
		}
		const decoded = await identifyType(prog);
		// A lone value (null, a number, a string) is whole already and keeps no hold on the
		// response, so the caller has nothing to close it with.
		if (!(decoded instanceof ArrayProgressive || decoded instanceof ObjectProgressive))
			prog.close();
		return decoded as Progressive<X>;
	} catch (error) {
		// No decoder reached the caller, so nothing else can close the response.
		prog.close();
		throw error;
	}
}
/*
const test = [1, 2, 3, 4, 5, 6];
const blob = new Blob([JSON.stringify(test)]);
ProgessiveDecodeJSON<typeof test>("https://api.github.com/repos/spacebarchat/server/git/refs")
	.then(async (obj) => {
		console.log(await obj.getWhole()); //returns the ping object
	})
	.then(console.warn);
//*/
