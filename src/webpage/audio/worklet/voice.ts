import {BinRead} from "../../utils/binaryUtils.js";

class AVoice {
	info: {wave: string | ((t: number, freq: number) => number); freq: number};
	playing: boolean;
	length = 1;
	volume: number;
	constructor(
		wave: string | ((t: number, freq: number) => number),
		freq: number,
		volume = 1,
		length = 1000,
	) {
		this.length = length;
		this.info = {wave, freq};
		this.playing = false;
		this.volume = volume;
	}
	clone(volume: number, freq: number, length = this.length) {
		return new AVoice(this.wave, freq, volume, length);
	}
	get wave(): string | ((t: number, freq: number) => number) {
		return this.info.wave;
	}
	get freq(): number {
		return this.info.freq;
	}
	set wave(wave: string | ((t: number, freq: number) => number)) {
		this.info.wave = wave;
	}
	set freq(freq: number) {
		this.info.freq = freq;
	}
	getNumber(time: number) {
		if (time < 0 || time > this.length) {
			return 0;
		}
		function smoothening(num: number) {
			return 1 / (1 + Math.E ** (-10 * (num - 0.5)));
		}
		let fade = 1;
		const range = 10;
		if (time < range) {
			fade = smoothening(time / range);
		}
		if (this.length - time < range) {
			fade = smoothening((this.length - time) / range);
		}
		const func = this.waveFunction();
		return func(time / 1000, this.freq) * fade;
	}
	isdone(time: number) {
		return time > this.length;
	}
	waveFunction(): (t: number, freq: number) => number {
		if (typeof this.wave === "function") {
			return this.wave;
		}
		switch (this.wave) {
			case "sin":
				return (t: number, freq: number) => {
					return Math.sin(t * Math.PI * 2 * freq);
				};
			case "triangle":
				return (t: number, freq: number) => {
					return Math.abs(((4 * t * freq) % 4) - 2) - 1;
				};
			case "sawtooth":
				return (t: number, freq: number) => {
					return ((t * freq) % 1) * 2 - 1;
				};
			case "square":
				return (t: number, freq: number) => {
					return (t * freq) % 2 < 1 ? 1 : -1;
				};
			case "white":
				return (_t: number, _freq: number) => {
					return Math.random() * 2 - 1;
				};
		}
		return () => 0;
	}
	/*
	static noises(noise: string): void {
		switch (noise) {
			case "join": {
				const voicy = new AVoice("triangle", 600, 0.1);
				voicy.play();
				setTimeout((_) => {
					voicy.freq = 800;
				}, 75);
				setTimeout((_) => {
					voicy.freq = 1000;
				}, 150);
				setTimeout((_) => {
					voicy.stop();
				}, 200);
				break;
			}
			case "leave": {
				const voicy = new AVoice("triangle", 850, 0.5);
				voicy.play();
				setTimeout((_) => {
					voicy.freq = 700;
				}, 100);
				setTimeout((_) => {
					voicy.stop();
					voicy.freq = 400;
				}, 180);
				setTimeout((_) => {
					voicy.play();
				}, 200);
				setTimeout((_) => {
					voicy.stop();
				}, 250);
				break;
			}
		}
	}
	*/
	static getVoice(read: BinRead): [AVoice, string] {
		const name = read.readAsciiString8();
		let length = read.readFloat32();
		let special: ((t: number, freq: number) => number) | string;
		if (length !== 0) {
			special = this.parseExpression(read);
		} else {
			special = name;
			length = 1;
		}
		return [new AVoice(special, 0, 0, length), name];
	}
	static parseExpression(read: BinRead): (t: number, freq: number) => number {
		return new Function("t", "f", `return ${this.PEHelper(read)};`) as (
			t: number,
			freq: number,
		) => number;
	}
	static PEHelper(read: BinRead): string {
		let state = read.read8();
		switch (state) {
			case 0:
				return "" + read.readFloat32();
			case 1:
				return "t";
			case 2:
				return "f";
			case 3:
				return `Math.PI`;
			case 4:
				return `Math.sin(${this.PEHelper(read)})`;
			case 5:
				return `(${this.PEHelper(read)}*${this.PEHelper(read)})`;
			case 6:
				return `(${this.PEHelper(read)}+${this.PEHelper(read)})`;
			case 7:
				return `(${this.PEHelper(read)}/${this.PEHelper(read)})`;
			case 8:
				return `(${this.PEHelper(read)}-${this.PEHelper(read)})`;
			case 9:
				return `(${this.PEHelper(read)}**${this.PEHelper(read)})`;
			case 10:
				return `(${this.PEHelper(read)}%${this.PEHelper(read)})`;
			case 11:
				return `Math.abs(${this.PEHelper(read)})`;
			case 12:
				return `Math.round(${this.PEHelper(read)})`;
			case 13:
				return `Math.cos(${this.PEHelper(read)})`;
			default:
				throw new Error("unexpected case found!");
		}
	}
}

export {AVoice as AVoice};
