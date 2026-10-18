import {Dialog} from "../settings.js";
import {refusalText} from "./refusalText.js";

export {formErrors, refusalText} from "./refusalText.js";

/** Tells the user a request was refused, or never answered (see refusalText). */
export async function showRefusal(res: Response | undefined) {
	new Dialog(await refusalText(res)).show();
}
