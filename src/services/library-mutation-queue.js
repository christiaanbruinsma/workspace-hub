/**
 * Serialises library mutations and deduplicates an identical pending request.
 * The operation itself receives no stale candidate; callers must read the
 * latest committed library inside the queued callback.
 */
export class LibraryMutationQueue {
  constructor() {
    this._tail = Promise.resolve();
    this._pending = new Map();
  }

  enqueue(key, operation) {
    if (typeof key !== 'string' || key.length === 0)
      throw new Error('A mutation queue key is required');
    if (typeof operation !== 'function')
      throw new Error('A mutation operation is required');
    if (this._pending.has(key))
      return this._pending.get(key);

    const promise = this._tail.then(() => operation());
    this._tail = promise.catch(() => undefined);
    this._pending.set(key, promise);

    const release = () => {
      if (this._pending.get(key) === promise)
        this._pending.delete(key);
    };
    promise.then(release, release);
    return promise;
  }

  hasPending(key) {
    return this._pending.has(key);
  }
}
