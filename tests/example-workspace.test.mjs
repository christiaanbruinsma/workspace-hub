import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {createExampleWorkspaceProfile, nextExampleWorkspaceName} from '../src/services/example-workspace.js';
import {addWorkspace, createWorkspaceLibrary} from '../src/services/workspace-library-contract.js';

test('example workspace is independent, active-ready and collision-safe', () => {
  const original = createEmptyProfile();
  original.profile.id = 'workspace-one';
  original.profile.name = 'Daily Workspace';
  const library = createWorkspaceLibrary(original);
  const before = structuredClone(library);

  const example = createExampleWorkspaceProfile(library, {id: 'example-one'});

  assert.equal(example.profile.id, 'example-one');
  assert.equal(example.profile.name, 'Example Workspace');
  assert.equal(example.profile.source, 'example');
  assert.equal(example.settings.setup_completed, true);
  assert.ok(example.sections.apps.length > 0);
  assert.deepEqual(library, before);
});

test('example names remain clear when example workspaces already exist', () => {
  const original = cloneDefaultProfile();
  original.profile.id = 'example-existing';
  const second = cloneDefaultProfile();
  second.profile.id = 'example-second';
  second.profile.name = 'Example Workspace 2';
  const library = addWorkspace(createWorkspaceLibrary(original), second);

  assert.equal(nextExampleWorkspaceName(library), 'Example Workspace 3');
  assert.equal(
    createExampleWorkspaceProfile(library, {id: 'example-third'}).profile.name,
    'Example Workspace 3'
  );
});

test('example workspace requires a new non-colliding id', () => {
  const original = cloneDefaultProfile();
  const library = createWorkspaceLibrary(original);

  assert.throws(() => createExampleWorkspaceProfile(library), /id is required/i);
  assert.throws(
    () => createExampleWorkspaceProfile(library, {id: original.profile.id}),
    /duplicate workspace id/i
  );
});
