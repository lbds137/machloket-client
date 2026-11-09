/**
 * localStorage.setItem that logs a refused write instead of throwing it. A store whose quota
 * is used up (or that the browser blocks) refuses every write; code that runs while the app
 * boots must carry on with what it could read. Returns whether the write landed.
 */
export function trySetItem(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (error) {
		console.error(error);
		return false;
	}
}
