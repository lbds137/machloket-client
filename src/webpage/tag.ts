import {Channel} from "./channel";
import {Emoji} from "./emoji";
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

		if (this.emoji_id) {
			tagDiv.append(new Emoji({id: this.emoji_id, name: this.emoji_name ?? ""}, this.owner.guild).getHTML(false, false));
		} else if (this.emoji_name) {
			tagDiv.append(this.emoji_name);
		}

		const name = document.createElement("span");
		name.textContent = this.name;
		tagDiv.append(name);

		return tagDiv;
	}
}
