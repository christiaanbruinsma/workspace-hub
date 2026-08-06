import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceActivationCoordinator} from '../src/services/workspace-activation-coordinator.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return {promise, resolve, reject};
};

function fixture() {
  let activeWorkspaceId = 'A';
  const commits = [];
  const reconciliations = [];
  const busyStates = [];
  const errors = [];
  const gates = [];

  const coordinator = new WorkspaceActivationCoordinator({
    getActiveWorkspaceId: () => activeWorkspaceId,
    commit: async workspaceId => {
      commits.push(workspaceId);
      const gate = gates.shift();
      if (gate)
        await gate.promise;
      activeWorkspaceId = workspaceId;
    },
    reconcile: workspaceId => { reconciliations.push(workspaceId); },
    onBusyChanged: busy => busyStates.push(busy),
    onError: error => errors.push(error),
  });

  return {
    coordinator,
    commits,
    reconciliations,
    busyStates,
    errors,
    gates,
    get activeWorkspaceId() { return activeWorkspaceId; },
  };
}

test('runner starts the store commit immediately', async () => {
  const state = fixture();
  const gate = deferred();
  state.gates.push(gate);

  const run = state.coordinator.request('B');

  assert.deepEqual(state.commits, ['B']);
  gate.resolve();
  await run;
  assert.deepEqual(state.reconciliations, ['B']);
});

test('latest workspace intent wins while a commit is pending', async () => {
  const state = fixture();
  const gate = deferred();
  state.gates.push(gate);

  const run = state.coordinator.request('B');
  await Promise.resolve();
  state.coordinator.request('A');
  gate.resolve();
  await run;

  assert.deepEqual(state.commits, ['B', 'A']);
  assert.deepEqual(state.reconciliations, ['A']);
  assert.equal(state.activeWorkspaceId, 'A');
});

test('duplicate pending target commits and reconciles once', async () => {
  const state = fixture();
  const gate = deferred();
  state.gates.push(gate);

  const run = state.coordinator.request('B');
  await Promise.resolve();
  state.coordinator.request('B');
  gate.resolve();
  await run;

  assert.deepEqual(state.commits, ['B']);
  assert.deepEqual(state.reconciliations, ['B']);
});

test('rapid B then A then B settles on B without an intermediate rebuild', async () => {
  const state = fixture();
  const gate = deferred();
  state.gates.push(gate);

  const run = state.coordinator.request('B');
  await Promise.resolve();
  state.coordinator.request('A');
  state.coordinator.request('B');
  gate.resolve();
  await run;

  assert.deepEqual(state.commits, ['B']);
  assert.deepEqual(state.reconciliations, ['B']);
  assert.equal(state.activeWorkspaceId, 'B');
});

test('already active target skips persistence', async () => {
  const state = fixture();
  const result = await state.coordinator.request('A');

  assert.equal(result.status, 'already-active');
  assert.deepEqual(state.commits, []);
  assert.deepEqual(state.reconciliations, []);
});

test('busy state spans activation and resets after failure', async () => {
  let activeWorkspaceId = 'A';
  const busyStates = [];
  const errors = [];
  const coordinator = new WorkspaceActivationCoordinator({
    getActiveWorkspaceId: () => activeWorkspaceId,
    commit: async () => { throw new Error('commit failed'); },
    reconcile: () => { throw new Error('must not reconcile'); },
    onBusyChanged: busy => busyStates.push(busy),
    onError: error => errors.push(error),
  });

  const result = await coordinator.request('B');
  await Promise.resolve();

  assert.equal(result.status, 'failed');
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(errors.length, 1);
  assert.equal(coordinator.isBusy, false);
});
