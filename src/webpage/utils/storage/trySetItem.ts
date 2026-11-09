/** Whether a storage write's error is the store refusing it: any DOMException (a full quota, a
 * browser that blocks storage, a value that can't be serialised). Anything else (a TypeError)
 * is a bug in the caller. */
export function isStoreRefusal(error: unknown): error is DOMException {
	return error instanceof DOMException;
}

/**
 * localStorage.setItem that logs a refused write instead of throwing it. A store whose quota
 * is used up (or that the browser blocks) refuses every write; code that runs while the app
 * boots must carry on with what it could read. Returns whether the write landed. Any other
 * error is thrown, so a bug doesn't pass for a full store.
 */
export function trySetItem(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (error) {
		if (!isStoreRefusal(error)) throw error;
		console.error(error);
		return false;
	}
}
