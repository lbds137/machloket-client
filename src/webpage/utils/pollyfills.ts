Set.prototype.intersection ||= function <T>(set: Set<T>) {
	const newSet = new Set();
	for (const elm of this) {
		if (set.has(elm)) {
			newSet.add(elm);
		}
	}
	return newSet;
};
Set.prototype.difference ||= function <T>(set: Set<T>) {
	const newSet = new Set();
	for (const elm of this) {
		if (!set.has(elm)) {
			newSet.add(elm);
		}
	}
	return newSet;
};
Set.prototype.symmetricDifference ||= function <T>(set: Set<T>) {
	const newSet = new Set();
	for (const elm of this) {
		if (!set.has(elm)) {
			newSet.add(elm);
		}
	}
	for (const elm of set) {
		if (!this.has(elm)) {
			newSet.add(elm);
		}
	}
	return newSet;
};
Set.prototype.isDisjointFrom ||= function <T>(set: Set<T>) {
	return this.symmetricDifference(set).size === 0;
};
Set.prototype.union ||= function <T>(set: Set<T>) {
	return new Set([...this, ...set]);
};
