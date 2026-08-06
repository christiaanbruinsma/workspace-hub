import test from 'node:test';
import assert from 'node:assert/strict';
import {executeLibraryTransaction} from '../src/services/library-transaction.js';

function transactionHarness(overrides = {}) {
  const calls = [];
  const live = {library:{value:1}};
  const disk = {library:{value:1}, etag:'etag-1'};
  const options = {
    readCurrent: () => {
      calls.push('read');
      return {library:structuredClone(disk.library), etag:disk.etag};
    },
    buildCandidate: current => {
      calls.push('build');
      return {
        candidateLibrary:{value:current.value + 1},
        restorePoints:[{workspaceId:'source', profile:{value:current.value}}, {workspaceId:'destination', profile:{value:10}}],
        historyRecords:[{id:'source-history'}, {id:'destination-history'}],
        metadata:{value:2},
      };
    },
    validateCandidate: candidate => {
      calls.push('validate');
      assert.equal(candidate.value, 2);
    },
    createRestorePoint: restore => {
      calls.push(`restore:${restore.workspaceId}`);
      return `${restore.workspaceId}.json`;
    },
    persist: (candidate, etag) => {
      calls.push(`persist:${etag}`);
      disk.library = structuredClone(candidate);
      disk.etag = 'etag-2';
    },
    publish: candidate => {
      calls.push('publish');
      live.library = structuredClone(candidate);
    },
    writeHistory: (records, restoreFiles) => {
      calls.push('history');
      assert.equal(records.length, 2);
      assert.deepEqual(restoreFiles.map(item => item.restoreFile), ['source.json','destination.json']);
    },
    ...overrides,
  };
  const run = () => executeLibraryTransaction(options);
  return {calls, live, disk, run};
}

test('transaction order is read, build, validate, all restorepoints, one persist, publish, then history', () => {
  const harness = transactionHarness();
  const result = harness.run();
  assert.deepEqual(harness.calls, [
    'read','build','validate','restore:source','restore:destination','persist:etag-1','publish','history',
  ]);
  assert.equal(result.status, 'committed');
  assert.equal(result.committed, true);
});

test('first restorepoint failure prevents persistence, publication and history', () => {
  const harness = transactionHarness({
    createRestorePoint: restore => {
      harness.calls.push(`restore:${restore.workspaceId}`);
      throw new Error('source restore failed');
    },
  });
  const liveBefore = structuredClone(harness.live.library);
  const diskBefore = structuredClone(harness.disk.library);
  assert.throws(harness.run, /source restore failed/);
  assert.deepEqual(harness.live.library, liveBefore);
  assert.deepEqual(harness.disk.library, diskBefore);
  assert.equal(harness.calls.some(call => call.startsWith('persist:')), false);
  assert.equal(harness.calls.includes('publish'), false);
  assert.equal(harness.calls.includes('history'), false);
});

test('second restorepoint failure can leave first unused restorepoint but blocks commit and history', () => {
  const created = [];
  const harness = transactionHarness({
    createRestorePoint: restore => {
      harness.calls.push(`restore:${restore.workspaceId}`);
      if (restore.workspaceId === 'destination')
        throw new Error('destination restore failed');
      created.push('source.json');
      return 'source.json';
    },
  });
  const liveBefore = structuredClone(harness.live.library);
  const diskBefore = structuredClone(harness.disk.library);
  assert.throws(harness.run, /destination restore failed/);
  assert.deepEqual(created, ['source.json']);
  assert.deepEqual(harness.live.library, liveBefore);
  assert.deepEqual(harness.disk.library, diskBefore);
  assert.equal(harness.calls.some(call => call.startsWith('persist:')), false);
  assert.equal(harness.calls.includes('publish'), false);
  assert.equal(harness.calls.includes('history'), false);
});

test('stale or failed persistence preserves old disk and live state and writes no history', () => {
  const harness = transactionHarness({
    persist: (_candidate, etag) => {
      harness.calls.push(`persist:${etag}`);
      throw new Error('stale library commit');
    },
  });
  const liveBefore = structuredClone(harness.live.library);
  const diskBefore = structuredClone(harness.disk.library);
  assert.throws(harness.run, /stale library commit/);
  assert.deepEqual(harness.live.library, liveBefore);
  assert.deepEqual(harness.disk.library, diskBefore);
  assert.equal(harness.calls.includes('publish'), false);
  assert.equal(harness.calls.includes('history'), false);
});

test('history is attempted only after persistence and publication', () => {
  const harness = transactionHarness();
  harness.run();
  const persistIndex = harness.calls.indexOf('persist:etag-1');
  const publishIndex = harness.calls.indexOf('publish');
  const historyIndex = harness.calls.indexOf('history');
  assert.ok(persistIndex >= 0 && persistIndex < publishIndex && publishIndex < historyIndex);
});

test('history failure after commit returns warning without rolling back valid state', () => {
  const harness = transactionHarness({
    writeHistory: () => {
      harness.calls.push('history');
      throw new Error('history failed');
    },
  });
  const result = harness.run();
  assert.equal(result.status, 'committed-with-history-warning');
  assert.equal(result.committed, true);
  assert.equal(harness.live.library.value, 2);
  assert.equal(harness.disk.library.value, 2);
  assert.match(result.historyWarning.message, /history failed/);
});
