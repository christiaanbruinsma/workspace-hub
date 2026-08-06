import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {resetWorkspaceContent} from '../src/services/workspace-reset.js';
import {
  activeWorkspaceProfile,
  addWorkspace,
  createWorkspaceLibrary,
  replaceActiveWorkspace,
  validateWorkspaceLibrary,
} from '../src/services/workspace-library-contract.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configuredWorkspace() {
  const profile = createEmptyProfile();
  profile.profile = {
    id: 'client-workspace',
    name: 'Client Workspace',
    organisation: 'Client Ltd',
    revision: 'customer-revision',
    managed_by: 'Local administrator',
    source: 'imported',
  };
  profile.settings.greeting_name = 'Alex';
  profile.settings.icon_style = 'fluent-linux-grey';
  profile.settings.application_icon_policy = 'dashboard';
  profile.settings.section_visibility.apps = false;
  profile.settings.section_tabs.apps = {
    tabs: [
      {id: 'general', title: 'Renamed default', position: 1, is_default: true},
      {id: 'design', title: 'Design', position: 2, is_default: false},
    ],
    active_tab_id: 'design',
  };
  profile.sections.apps = [{
    id: 'test-app',
    type: 'application',
    tab_id: 'design',
    title: 'Test app',
    subtitle: '',
    icon_name: 'application-x-executable-symbolic',
    desktop_id: 'test.desktop',
    application_source: 'unknown',
    icon_override: 'inherit',
    origin: 'local',
    locked: false,
    position: 1,
    enabled: true,
  }];
  profile.sections.help_support = [{
    id: 'support',
    type: 'web',
    title: 'Support',
    subtitle: '',
    icon_name: 'help-browser-symbolic',
    icon_role: 'guide',
    url: 'https://example.com',
    origin: 'local',
    locked: false,
    position: 1,
    enabled: true,
  }];
  return profile;
}

test('reset clears configured items and custom tabs while preserving workspace identity and settings', () => {
  const profile = configuredWorkspace();
  const identity = clone(profile.profile);
  const preservedSettings = {
    greeting_name: profile.settings.greeting_name,
    icon_style: profile.settings.icon_style,
    application_icon_policy: profile.settings.application_icon_policy,
    section_visibility: clone(profile.settings.section_visibility),
  };

  const reset = resetWorkspaceContent(profile);

  assert.deepEqual(reset.profile, identity);
  assert.equal(reset.settings.greeting_name, preservedSettings.greeting_name);
  assert.equal(reset.settings.icon_style, preservedSettings.icon_style);
  assert.equal(reset.settings.application_icon_policy, preservedSettings.application_icon_policy);
  assert.deepEqual(reset.settings.section_visibility, preservedSettings.section_visibility);
  for (const items of Object.values(reset.sections))
    assert.deepEqual(items, []);
  for (const state of Object.values(reset.settings.section_tabs)) {
    assert.deepEqual(state, {
      tabs: [{id: 'general', title: 'General', position: 1, is_default: true}],
      active_tab_id: 'general',
    });
  }
});

test('resetting a non-initial active workspace leaves every other workspace unchanged', () => {
  const first = cloneDefaultProfile();
  const second = configuredWorkspace();
  let library = createWorkspaceLibrary(first);
  library = addWorkspace(library, second, {activate: true});
  const firstBefore = clone(library.workspaces[0]);

  const reset = resetWorkspaceContent(activeWorkspaceProfile(library));
  const updated = replaceActiveWorkspace(library, reset);

  validateWorkspaceLibrary(updated);
  assert.equal(updated.active_workspace_id, 'client-workspace');
  assert.deepEqual(updated.workspaces[0], firstBefore);
  assert.equal(updated.workspaces[1].id, 'client-workspace');
  assert.equal(updated.workspaces[1].profile.profile.name, 'Client Workspace');
  assert.deepEqual(updated.workspaces[1].profile.sections.apps, []);
});

test('resetting the initial workspace also retains its stable identifier', () => {
  const profile = cloneDefaultProfile();
  const library = createWorkspaceLibrary(profile);
  const reset = resetWorkspaceContent(activeWorkspaceProfile(library));
  const updated = replaceActiveWorkspace(library, reset);

  assert.equal(updated.workspaces.length, 1);
  assert.equal(updated.active_workspace_id, profile.profile.id);
  assert.equal(updated.workspaces[0].id, profile.profile.id);
  assert.equal(updated.workspaces[0].profile.profile.name, profile.profile.name);
});

test('settings UI targets the current workspace and does not create a replacement profile', async () => {
  const source = await readFile(new URL('../src/window.js', import.meta.url), 'utf8');
  assert.match(source, /title: 'Reset current workspace'/);
  assert.match(source, /Other workspaces are not changed\./);
  assert.match(source, /heading: `Reset “\$\{workspaceName\}”\?`/);
  assert.match(source, /resetWorkspaceContent\(this\._profile\)/);
  assert.doesNotMatch(source, /createEmptyProfile\(/);
  assert.doesNotMatch(source, /Started an empty workspace/);
  assert.match(source, /action: 'workspace-reset'/);
});
