import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowSource = fs.readFileSync(path.join(root, 'src/window.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'src/services/profile-store.js'), 'utf8');
const dialogSource = fs.readFileSync(path.join(root, 'src/ui/copy-workspace-contents-dialog.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'src/services/i18n.js'), 'utf8');

test('Manage Workspaces exposes a guarded Copy contents to action', () => {
  assert.match(windowSource, /'copy-contents'.*?_copyWorkspaceContents\(summary\).*?canCopyContents/s);
  assert.match(windowSource, /primary\.append\(this\._t\('copy_workspace_contents'\), 'workspace\.copy-contents'\)/);
  assert.match(windowSource, /getWorkspaceContentsCopyDestinations\(summary\.id\)/);
  assert.match(windowSource, /_closeWorkspaceManager\(\(\) => this\._copyWorkspaceContents\(summary\)\)/);
});

test('copy flow requires a separate destructive overwrite confirmation', () => {
  assert.match(windowSource, /presentWorkspaceContentsDestinationDialog\(\{/);
  assert.match(windowSource, /onSelect: destination => this\._confirmCopyWorkspaceContents\(summary, destination\)/);
  assert.match(windowSource, /dialog\.set_response_appearance\('replace', Adw\.ResponseAppearance\.DESTRUCTIVE\)/);
  assert.match(windowSource, /await this\._store\.copyWorkspaceContents\(source\.id, target\.id\)/);
  assert.match(windowSource, /this\._refreshWorkspaceView\(this\._currentPage\)/);

  const method = windowSource.slice(
    windowSource.indexOf('  _confirmCopyWorkspaceContents('),
    windowSource.indexOf('  _archiveWorkspace(', windowSource.indexOf('  _confirmCopyWorkspaceContents('))
  );
  assert.doesNotMatch(method, /_activateWorkspace\(/);
});

test('destination dialog keeps stable IDs separate from display labels', () => {
  assert.match(dialogSource, /destinations\.map\(destination => destination\.displayName\)/);
  assert.match(dialogSource, /const destination = destinations\[workspaceRow\.get_selected\(\)\]/);
  assert.match(dialogSource, /dialog\.choose_finish\(result\)/);
});

test('ProfileStore routes workspace content copy through one transaction plan', () => {
  assert.match(storeSource, /getWorkspaceContentsCopyDestinations\(sourceWorkspaceId\)/);
  assert.match(storeSource, /buildWorkspaceContentsCopyPlan\(currentLibrary, \{/);
  assert.match(storeSource, /workspace-contents-copy:\$\{key\}/);
  assert.match(storeSource, /Workspace contents were copied but history could not be updated/);
});

test('public copy wording states overwrite, restore point and retained target identity', () => {
  for (const key of [
    'copy_workspace_contents',
    'replace_workspace_contents_heading',
    'replace_workspace_contents_body',
    'workspace_contents_replaced',
  ])
    assert.match(i18nSource, new RegExp(`${key}:`));
  assert.match(i18nSource, /A restore point will be created first/);
  assert.match(i18nSource, /target workspace name and identity will remain unchanged/i);
});
