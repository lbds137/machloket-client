import {BinRead} from "../../utils/binaryUtils.js";
import {Track} from "./track.js";

export class Audio {
	name: string;
	tracks: (Track | number)[];
	constructor(name: string, tracks: (Track | number)[]) {
		this.tracks = tracks;
		this.name = name;
	}
	static parse(read: BinRead, trackarr: Track[]): Audio {
		const name = read.readAsciiString8();
		const length = read.read16();
		const tracks: (Track | number)[] = [];
		for (let i = 0; i < length; i++) {
			let index = read.read16();
			if (index === 0) {
				tracks.push(read.readFloat32());
			} else {
				tracks.push(trackarr[index - 1]);
			}
		}
		return new Audio(name, tracks);
	}
	isdone(time: number) {
		let cur = 0;
		for (const thing of this.tracks) {
			if (thing instanceof Track) {
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
		for (const thing of this.tracks) {
			if (thing instanceof Track) {
				const vol = thing.getNumber(time - cur);
				if (vol !== 0) {
					av += Math.log(10 ** av + 10 ** vol);
				}
			} else {
				cur += thing;
			}
		}
		return av;
	}
}
