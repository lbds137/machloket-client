import {I18n} from "../i18n.js";
import {getStringURLMap} from "./utils.js";
import {instanceLabel} from "./instanceLabel.js";

/** A landing page's message for a link whose `?instance=` can't be found: its host, or no name. */
export function instanceUnreachableText(well: string): string {
	const label = instanceLabel(well, getStringURLMap());
	return label ? I18n.instanceUnreachable(label) : I18n.instanceUnreachableUnnamed();
}
