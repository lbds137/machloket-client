import {Channel} from "./channel";
import {tagjson} from "./jsontypes";
import {SnowFlake} from "./snowflake";

export class Tag extends SnowFlake {
	name: string;
	moderated: boolean;
	emoji_id?: string;
	emoji_name?: string;
	owner: Channel;
	constructor(json: tagjson, owner: Channel) {
		super(json.id);
		this.name = json.name;
		this.moderated = json.moderated;
		this.update(json);
		this.owner = owner;
	}
	update(json: tagjson) {
		this.name = json.name;
		this.moderated = json.moderated;
		this.emoji_id = json.emoji_id;
		this.emoji_name = json.emoji_name;
	}
	makeHTML() {
		const tagDiv = document.createElement("div");
		tagDiv.classList.add("forumTag");

		//TODO render emojis

		const name = document.createElement("span");
		name.textContent = this.name;
		tagDiv.append(name);

		return tagDiv;
	}
}
