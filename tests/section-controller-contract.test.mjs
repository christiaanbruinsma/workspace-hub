import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSectionControllerIdentity,
  disposeSectionController,
  sectionControllerMatches,
} from '../src/ui/section-controller-contract.js';

function controller(overrides = {}) {
  return {
    ...createSectionControllerIdentity({
      workspaceId: 'workspace-a',
      pageId: 'overview',
      sectionName: 'apps',
      generation: 4,
    }),
    isDisposed: false,
    ...overrides,
  };
}

const expected = {
  workspaceId: 'workspace-a',
  pageId: 'overview',
  sectionName: 'apps',
  generation: 4,
};

test('controller matches only the current stable identity and generation', () => {
  assert.equal(sectionControllerMatches(controller(), expected), true);
  assert.equal(sectionControllerMatches(controller({workspaceId: 'workspace-b'}), expected), false);
  assert.equal(sectionControllerMatches(controller({pageId: 'apps'}), expected), false);
  assert.equal(sectionControllerMatches(controller({sectionName: 'web_apps'}), expected), false);
  assert.equal(sectionControllerMatches(controller({generation: 3}), expected), false);
});

test('disposed controllers never match even when identity and generation are equal', () => {
  const value = controller();
  disposeSectionController(value);
  assert.equal(value.isDisposed, true);
  assert.equal(sectionControllerMatches(value, expected), false);
});

test('identity construction rejects incomplete or invalid generations', () => {
  assert.throws(() => createSectionControllerIdentity({workspaceId:'', pageId:'overview', sectionName:'apps', generation:1}), /Workspace id/);
  assert.throws(() => createSectionControllerIdentity({workspaceId:'a', pageId:'', sectionName:'apps', generation:1}), /Page id/);
  assert.throws(() => createSectionControllerIdentity({workspaceId:'a', pageId:'overview', sectionName:'', generation:1}), /Section name/);
  assert.throws(() => createSectionControllerIdentity({workspaceId:'a', pageId:'overview', sectionName:'apps', generation:0}), /positive integer/);
});
