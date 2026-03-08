export class CDNParams {
	expectedSize: number;
	keep_aspect_ratio: boolean;
	animated: boolean;
	constructor({
		expectedSize,
		keep_aspect_ratio,
		animated,
	}: {expectedSize?: number; keep_aspect_ratio?: boolean; animated?: boolean} = {}) {
		this.expectedSize = expectedSize ?? 300;
		this.keep_aspect_ratio = keep_aspect_ratio ?? false;
		this.animated = animated ?? true;
	}
	getSize() {
		return this.expectedSize;
	}
	toString() {
		return (
			"?" +
			new URLSearchParams([
				["size", this.getSize() + ""],
				["keep_aspect_ratio", this.keep_aspect_ratio + ""],
				["animated", this.animated + ""],
			])
		);
	}
}
