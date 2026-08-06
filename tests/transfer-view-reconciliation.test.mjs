import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransferViewRefreshPlan} from '../src/ui/transfer-view-reconciliation.js';

function input(overrides = {}) {
  return {
    mode: 'copy',
    activeWorkspaceId: 'source',
    sourceWorkspaceId: 'source',
    destinationWorkspaceId: 'destination',
    sectionName: 'apps',
    sourceTabId: 'general',
    destinationTabId: 'work',
    currentPage: 'overview',
    ...overrides,
  };
}

test('copy leaves a visible source collection unchanged', () => {
  assert.deepEqual(buildTransferViewRefreshPlan(input()), {kind:'none'});
});

test('move refreshes the visible source collection immediately', () => {
  assert.deepEqual(buildTransferViewRefreshPlan(input({mode:'move'})), {
    kind:'source', workspaceId:'source', pageId:'overview', sectionName:'apps', tabId:'general',
  });
});

test('copy and move refresh the destination when it is active at completion', () => {
  for (const mode of ['copy', 'move']) {
    assert.deepEqual(buildTransferViewRefreshPlan(input({mode, activeWorkspaceId:'destination', currentPage:'apps'})), {
      kind:'destination', workspaceId:'destination', pageId:'apps', sectionName:'apps', tabId:'work',
    });
  }
});

test('unrelated pages and unrelated active workspaces do not rebuild', () => {
  assert.deepEqual(buildTransferViewRefreshPlan(input({activeWorkspaceId:'third'})), {kind:'none'});
  assert.deepEqual(buildTransferViewRefreshPlan(input({activeWorkspaceId:'destination', currentPage:'settings'})), {kind:'none'});
});

test('help and support uses the same plan without a tab id', () => {
  assert.deepEqual(buildTransferViewRefreshPlan(input({
    activeWorkspaceId:'destination', sectionName:'help_support', currentPage:'help_support',
    sourceTabId:null, destinationTabId:null,
  })), {
    kind:'destination', workspaceId:'destination', pageId:'help_support', sectionName:'help_support', tabId:null,
  });
});

test('unsupported modes fail closed', () => {
  assert.throws(() => buildTransferViewRefreshPlan(input({mode:'clone'})), /Unsupported transfer mode/);
});
