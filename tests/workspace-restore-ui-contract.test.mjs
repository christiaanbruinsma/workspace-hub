import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowSource = fs.readFileSync(path.join(root, 'src/window.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'src/services/profile-store.js'), 'utf8');

test('Settings exposes explicit history restore and independent example creation only', () => {
  assert.match(windowSource, /title: 'Create example workspace'/);
  assert.match(windowSource, /this\._store\.createExampleWorkspace\(\{activate: true\}\)/);
  assert.match(storeSource, /_commitLibrary\('workspace-create-example', library => \{/);
  assert.match(storeSource, /createExampleWorkspaceProfile\(library, \{id: workspaceId\}\)/);
  assert.match(windowSource, /Workspace History/);
  assert.match(storeSource, /restorePoints: \[\{workspaceId: imported\.profile\.id, profile: previousProfile\}\]/);
});

test('reset confirmation explains that a restore point is created first', () => {
  assert.match(windowSource, /A restore point of the current configuration will be created first/);
});


test('normal saves and imports attach restore points to the correct workspace history', () => {
  const saveStart = storeSource.indexOf('  save(profile, event = {}, applicationSettings = null) {');
  const saveEnd = storeSource.indexOf('  _commitPendingViewState(workspaceId) {', saveStart);
  const importStart = storeSource.indexOf('  importProfile(profile) {');
  const importEnd = storeSource.indexOf('  exportProfile(file) {', importStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.ok(importStart >= 0 && importEnd > importStart);

  const saveBlock = storeSource.slice(saveStart, saveEnd);
  const importBlock = storeSource.slice(importStart, importEnd);
  assert.match(saveBlock, /restorePoints: \[\{workspaceId: previousProfile\.profile\.id, profile: previousProfile\}\]/);
  assert.match(importBlock, /restorePoints: \[\{workspaceId: imported\.profile\.id, profile: previousProfile\}\]/);
});
