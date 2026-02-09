export class PromiseLock {
	lastLock = Promise.resolve();
	async acquireLock() {
		const {promise, resolve: res} = Promise.withResolvers<void>();
		const last = this.lastLock;
		this.lastLock = promise;
		await last;
		return res;
	}
}
