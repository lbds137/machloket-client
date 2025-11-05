import {BinRead} from "../../utils/binaryUtils.js";
import {mixAudio} from "./mixAudio.js";
import {AVoice} from "./voice.js";

export class Track {
	seq: (AVoice | number)[];
	constructor(playing: (AVoice | number)[]) {
		this.seq = playing;
	}
	static parse(read: BinRead, play: [AVoice, string][], six: boolean): Track {
		const length = read.read16();
		const play2: (AVoice | number)[] = [];
		for (let i = 0; i < length; i++) {
			let index: number;
			if (six) {
				index = read.read16();
			} else {
				index = read.read8();
			}
			if (index === 0) {
				play2.push(read.readFloat32());
				continue;
			}
			index--;
			if (!play[index]) throw new Error("voice not found");
			const [voice] = play[index];
			let temp: AVoice;
			if (voice.info.wave instanceof Function) {
				temp = voice.clone(read.readFloat32(), read.readFloat32());
			} else {
				temp = voice.clone(read.readFloat32(), read.readFloat32(), read.readFloat32());
			}
			play2.push(temp);
		}
		return new Track(play2);
	}
	isdone(time: number) {
		let cur = 0;
		for (const thing of this.seq) {
			if (thing instanceof AVoice) {
				if (!thing.isdone(time - cur)) {
					return false;
				}
			} else {
				cur += thing;
			}
		}
		return true;
	}
	getNumber(time: number) {
		let cur = 0;
		let av = 0;
		for (const thing of this.seq) {
			if (thing instanceof AVoice) {
				const vol = thing.getNumber(time - cur);
				if (vol !== 0) {
					av += mixAudio(av, vol);
				}
			} else {
				cur += thing;
			}
		}
		return av;
	}
}
