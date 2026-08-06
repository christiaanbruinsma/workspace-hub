/**
 * Coordinates workspace activation as latest-user-intent while keeping the
 * ProfileStore mutation queue as the sole persistence boundary.
 */
export class WorkspaceActivationCoordinator {
  constructor({
    getActiveWorkspaceId,
    commit,
    reconcile,
    onBusyChanged = () => {},
    onError = () => {},
  }) {
    if (typeof getActiveWorkspaceId !== 'function')
      throw new Error('getActiveWorkspaceId callback is required');
    if (typeof commit !== 'function')
      throw new Error('commit callback is required');
    if (typeof reconcile !== 'function')
      throw new Error('reconcile callback is required');
    if (typeof onBusyChanged !== 'function')
      throw new Error('onBusyChanged callback must be a function');
    if (typeof onError !== 'function')
      throw new Error('onError callback must be a function');

    this._getActiveWorkspaceId = getActiveWorkspaceId;
    this._commit = commit;
    this._reconcile = reconcile;
    this._onBusyChanged = onBusyChanged;
    this._onError = onError;
    this._latestWorkspaceId = null;
    this._runner = null;
  }

  get isBusy() {
    return this._runner !== null;
  }

  request(workspaceId) {
    const targetWorkspaceId = String(workspaceId ?? '').trim();
    if (!targetWorkspaceId)
      throw new Error('A target workspace is required');

    this._latestWorkspaceId = targetWorkspaceId;
    if (!this._runner && this._getActiveWorkspaceId() === targetWorkspaceId) {
      this._latestWorkspaceId = null;
      return Promise.resolve({status: 'already-active', workspaceId: targetWorkspaceId});
    }

    if (!this._runner)
      this._startRunner();

    return this._runner;
  }

  _startRunner() {
    this._onBusyChanged(true);
    const runner = this._drain();
    this._runner = runner;
    runner.finally(() => {
      if (this._runner !== runner)
        return;
      this._runner = null;
      this._onBusyChanged(false);
      if (this._latestWorkspaceId)
        this._startRunner();
    });
  }

  async _drain() {
    while (this._latestWorkspaceId) {
      const workspaceId = this._latestWorkspaceId;
      this._latestWorkspaceId = null;

      try {
        if (this._getActiveWorkspaceId() !== workspaceId)
          await this._commit(workspaceId);

        if (this._latestWorkspaceId)
          continue;

        if (this._getActiveWorkspaceId() !== workspaceId)
          throw new Error('The requested workspace was not activated');

        await this._reconcile(workspaceId);

        if (this._latestWorkspaceId)
          continue;

        return {status: 'applied', workspaceId};
      } catch (error) {
        this._onError(error);
        if (!this._latestWorkspaceId)
          return {status: 'failed', error};
      }
    }

    return {status: 'idle'};
  }
}
