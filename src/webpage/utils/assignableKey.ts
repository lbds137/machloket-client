/** Whether a key from server JSON may be copied onto `target`: never the prototype link, a
 * method, or a getter-only property (assigning one throws). Reads descriptors only, so no
 * getter runs. */
export function assignableKey(target: object, key: string) {
	if (key === "__proto__" || key === "constructor") return false;
	for (let obj: object | null = target; obj; obj = Object.getPrototypeOf(obj)) {
		const descriptor = Object.getOwnPropertyDescriptor(obj, key);
		if (!descriptor) continue;
		if (descriptor.get || descriptor.set) return !!descriptor.set;
		return typeof descriptor.value !== "function";
	}
	return true;
}
