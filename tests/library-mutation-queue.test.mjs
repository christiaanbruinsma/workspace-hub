import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {addWorkspace, createWorkspaceLibrary} from '../src/services/workspace-library-contract.js';
import {setWorkspaceItemGovernance} from '../src/services/workspace-items.js';
import {transferWorkspaceItem} from '../src/services/workspace-item-transfer.js';
import {LibraryMutationQueue} from '../src/services/library-mutation-queue.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(resolver => { resolve = resolver; });
  return {promise, resolve};
};

function fixture() {
  const source = cloneDefaultProfile();
  source.profile.id = 'source';
  const destination = createEmptyProfile();
  destination.profile.id = 'destination';
  return addWorkspace(createWorkspaceLibrary(source), destination);
}

function request(overrides = {}) {
  return {
    sourceWorkspaceId:'source', destinationWorkspaceId:'destination', sectionName:'apps',
    sourceItemId:'documents', destinationTabId:'general', mode:'copy', ...overrides,
  };
}

test('double activation executes one transfer and returns the same promise', async () => {
  const queue = new LibraryMutationQueue();
  let executions = 0;
  const gate = deferred();
  const first = queue.enqueue('same', async () => { executions += 1; await gate.promise; return 'done'; });
  const second = queue.enqueue('same', async () => { executions += 1; return 'duplicate'; });
  assert.equal(first, second);
  gate.resolve();
  assert.equal(await first, 'done');
  assert.equal(executions, 1);
});

test('two queued transfers execute in order and each callback reads latest committed state', async () => {
  const queue = new LibraryMutationQueue();
  let committed = fixture();
  const observedTitles = [];
  const first = queue.enqueue('edit', () => {
    const next = structuredClone(committed);
    next.workspaces[0].profile.sections.apps.find(item => item.id === 'documents').title = 'Latest title';
    committed = next;
  });
  const second = queue.enqueue('copy', () => {
    const result = transferWorkspaceItem(committed, request());
    committed = result.candidateLibrary;
    const copied = committed.workspaces[1].profile.sections.apps.find(item => item.id === result.metadata.resultingItemId);
    observedTitles.push(copied.title);
  });
  await Promise.all([first, second]);
  assert.deepEqual(observedTitles, ['Latest title']);
});

test('queued transfer re-resolves source and fails closed when item was removed before execution', async () => {
  const queue = new LibraryMutationQueue();
  let committed = fixture();
  const remove = queue.enqueue('remove', () => {
    const next = structuredClone(committed);
    next.workspaces[0].profile.sections.apps = next.workspaces[0].profile.sections.apps.filter(item => item.id !== 'documents');
    committed = next;
  });
  const transfer = queue.enqueue('copy', () => transferWorkspaceItem(committed, request()));
  await remove;
  await assert.rejects(transfer, /Workspace item not found/);
});

test('queued transfer re-resolves source and fails closed when item became locked before execution', async () => {
  const queue = new LibraryMutationQueue();
  let committed = fixture();
  const lock = queue.enqueue('lock', () => {
    const next = structuredClone(committed);
    const index = next.workspaces.findIndex(item => item.id === 'source');
    next.workspaces[index].profile = setWorkspaceItemGovernance(
      next.workspaces[index].profile, 'apps', 'documents', {origin:'organisation', locked:true}
    );
    committed = next;
  });
  const transfer = queue.enqueue('copy', () => transferWorkspaceItem(committed, request()));
  await lock;
  await assert.rejects(transfer, /managed by the organisation/);
});

test('a failed queued mutation does not block the next mutation', async () => {
  const queue = new LibraryMutationQueue();
  const first = queue.enqueue('first', () => { throw new Error('removed before execution'); });
  const second = queue.enqueue('second', () => 'committed');
  await assert.rejects(first, /removed before execution/);
  assert.equal(await second, 'committed');
});

test('transfer commit before activation lets activation observe the committed library', async () => {
  const queue = new LibraryMutationQueue();
  let committed = fixture();
  let activeWorkspaceId = 'source';
  let destinationItemCountAtActivation = null;

  const transfer = queue.enqueue('transfer-first', () => {
    const result = transferWorkspaceItem(committed, request());
    committed = result.candidateLibrary;
  });
  const activation = queue.enqueue('activation-second', () => {
    activeWorkspaceId = 'destination';
    destinationItemCountAtActivation = committed.workspaces
      .find(record => record.id === activeWorkspaceId).profile.sections.apps.length;
  });

  await Promise.all([transfer, activation]);
  assert.equal(activeWorkspaceId, 'destination');
  assert.equal(destinationItemCountAtActivation, 1);
});

test('activation commit before transfer leaves destination active for post-transfer reconciliation', async () => {
  const queue = new LibraryMutationQueue();
  let committed = fixture();
  let activeWorkspaceId = 'source';
  const observedActiveAtTransfer = [];

  const activation = queue.enqueue('activation-first', () => {
    activeWorkspaceId = 'destination';
  });
  const transfer = queue.enqueue('transfer-second', () => {
    observedActiveAtTransfer.push(activeWorkspaceId);
    const result = transferWorkspaceItem(committed, request());
    committed = result.candidateLibrary;
  });

  await Promise.all([activation, transfer]);
  assert.deepEqual(observedActiveAtTransfer, ['destination']);
  assert.equal(committed.workspaces[1].profile.sections.apps.length, 1);
});
