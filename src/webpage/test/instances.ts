import {getInstances} from "../utils/utils";

/**
 * Unlists every listed instance (all but `except`; ones already unlisted are left alone) by
 * the field the default-instance pickers read (`display`), before the page under test reads
 * its default. Returns only the instances this call hid, so a test can restore them in an
 * `onTestFinished`.
 */
export function unlistAllInstances(except?: string) {
	const unlisted: ReturnType<typeof getInstances> = [];
	for (const instance of getInstances()) {
		if (instance.name === except || instance.display === false) continue;
		instance.display = false;
		unlisted.push(instance);
	}
	return unlisted;
}
