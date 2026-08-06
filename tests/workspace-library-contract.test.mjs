import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {
  CURRENT_LIBRARY_SCHEMA_VERSION,
  activeWorkspaceProfile,
  addWorkspace,
  createWorkspaceLibrary,
  duplicateWorkspace,
  moveWorkspace,
  migrateLegacyProfileToLibrary,
  normaliseWorkspaceLibrary,
  removeWorkspace,
  renameWorkspace,
  replaceActiveWorkspace,
  serializeWorkspaceLibrary,
  setActiveWorkspace,
  setWorkspaceArchived,
  updateApplicationSettings,
  validateWorkspaceLibrary,
  workspaceLibrarySummary,
  workspaceProfile,
} from '../src/services/workspace-library-contract.js';

test('legacy schema 10 profiles migrate into a one-workspace library without losing language', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 10;
  legacy.settings.language = 'nl';
  const library = migrateLegacyProfileToLibrary(legacy);
  assert.equal(library.format, 'workspace-hub-library');
  assert.equal(library.schema_version, CURRENT_LIBRARY_SCHEMA_VERSION);
  assert.equal(library.application_settings.language, 'nl');
  assert.equal(library.workspaces.length, 1);
  const migrated = activeWorkspaceProfile(library);
  assert.equal(migrated.schema_version, 12);
  assert.equal('language' in migrated.settings, false);
  assert.deepEqual(migrated.profile, legacy.profile);
  assert.deepEqual(migrated.status, legacy.status);
  for (const sectionName of Object.keys(legacy.sections)) {
    assert.equal(migrated.sections[sectionName].length, legacy.sections[sectionName].length);
    assert.deepEqual(migrated.sections[sectionName].map(item => item.id), legacy.sections[sectionName].map(item => item.id));
  }
  assert.equal(migrated.settings.icon_style, legacy.settings.icon_style);
  assert.equal(migrated.settings.application_icon_policy, legacy.settings.application_icon_policy);
  assert.equal(migrated.settings.section_tabs.apps.active_tab_id, 'general');
  assert.equal(migrated.sections.apps.every(item => item.tab_id === 'general'), true);
});

test('workspace libraries support multiple profiles and a stable active workspace', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile(), {language: 'system'});
  const second = createEmptyProfile();
  second.profile.id = 'core-blueprint';
  second.profile.name = 'Core Blueprint';
  const expanded = addWorkspace(library, second, {activate: true});
  assert.equal(expanded.workspaces.length, 2);
  assert.equal(expanded.active_workspace_id, 'core-blueprint');
  assert.equal(activeWorkspaceProfile(expanded).profile.name, 'Core Blueprint');
  const switched = setActiveWorkspace(expanded, 'example-workspace');
  assert.equal(activeWorkspaceProfile(switched).profile.name, 'Example Workspace');
});

test('application settings are global and independent from workspace profiles', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile(), {language: 'system'});
  const changed = updateApplicationSettings(library, {language: 'de'});
  assert.equal(changed.application_settings.language, 'de');
  assert.equal('language' in activeWorkspaceProfile(changed).settings, false);
  assert.throws(() => updateApplicationSettings(library, {language: 'fr'}), /language is unsupported/);
});

test('replacing the active workspace updates its stable record and active ID', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  const replacement = createEmptyProfile();
  replacement.profile.id = 'example-company';
  replacement.profile.name = 'Example Company';
  const updated = replaceActiveWorkspace(library, replacement);
  assert.equal(updated.workspaces.length, 1);
  assert.equal(updated.active_workspace_id, 'example-company');
  assert.equal(updated.workspaces[0].id, 'example-company');
});

test('workspace library validation rejects duplicate IDs and archived active workspaces', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  const duplicate = JSON.parse(JSON.stringify(library));
  duplicate.workspaces.push(JSON.parse(JSON.stringify(duplicate.workspaces[0])));
  assert.throws(() => validateWorkspaceLibrary(duplicate), /Duplicate workspace id/);

  const archived = JSON.parse(JSON.stringify(library));
  archived.workspaces[0].archived = true;
  assert.throws(() => validateWorkspaceLibrary(archived), /active workspace cannot be archived/);
});

test('normalisation and serialization preserve a validated workspace library', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile(), {language: 'en'});
  const text = serializeWorkspaceLibrary(library);
  assert.equal(text.endsWith('\n'), true);
  const normalised = normaliseWorkspaceLibrary(JSON.parse(text));
  const summary = workspaceLibrarySummary(normalised);
  assert.equal(summary.total, 1);
  assert.equal(summary.active, 1);
  assert.equal(summary.archived, 0);
  assert.equal(summary.language, 'en');
});


test('future workspace library schemas are rejected fail-closed', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  library.schema_version = CURRENT_LIBRARY_SCHEMA_VERSION + 1;
  assert.throws(() => normaliseWorkspaceLibrary(library), /Unsupported workspace library schema version/);
});


test('workspace lifecycle supports rename, duplicate and independent profiles', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  const renamed = renameWorkspace(library, 'example-workspace', 'Example Company');
  assert.equal(activeWorkspaceProfile(renamed).profile.name, 'Example Company');
  assert.equal(activeWorkspaceProfile(renamed).profile.id, 'example-workspace');

  const duplicated = duplicateWorkspace(renamed, 'example-workspace', {
    id: 'core-blueprint',
    name: 'Core Blueprint',
    activate: true,
  });
  assert.equal(duplicated.workspaces.length, 2);
  assert.equal(duplicated.active_workspace_id, 'core-blueprint');
  assert.equal(workspaceProfile(duplicated, 'core-blueprint').profile.name, 'Core Blueprint');
  assert.deepEqual(
    workspaceProfile(duplicated, 'core-blueprint').sections,
    workspaceProfile(duplicated, 'example-workspace').sections,
  );
  const changedCopy = workspaceProfile(duplicated, 'core-blueprint');
  changedCopy.sections.apps = [];
  assert.notDeepEqual(changedCopy.sections, workspaceProfile(duplicated, 'example-workspace').sections);
});

test('archiving is fail-closed for the active workspace and reversible for inactive workspaces', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  const second = createEmptyProfile();
  second.profile.id = 'core-blueprint';
  second.profile.name = 'Core Blueprint';
  const expanded = addWorkspace(library, second);
  assert.throws(() => setWorkspaceArchived(expanded, expanded.active_workspace_id, true), /active workspace cannot be archived/);
  const archived = setWorkspaceArchived(expanded, 'core-blueprint', true);
  assert.equal(workspaceLibrarySummary(archived).archived, 1);
  assert.throws(() => setActiveWorkspace(archived, 'core-blueprint'), /archived workspace cannot be activated/);
  const restored = setWorkspaceArchived(archived, 'core-blueprint', false);
  assert.equal(workspaceLibrarySummary(restored).archived, 0);
});

test('workspace ordering moves only within the same active or archived group', () => {
  let library = createWorkspaceLibrary(cloneDefaultProfile());
  for (const [id, name] of [['core-blueprint', 'Core Blueprint'], ['client', 'Client']]) {
    const profile = createEmptyProfile();
    profile.profile.id = id;
    profile.profile.name = name;
    library = addWorkspace(library, profile);
  }
  library = setWorkspaceArchived(library, 'client', true);
  const unchanged = moveWorkspace(library, 'core-blueprint', 'down');
  assert.deepEqual(unchanged.workspaces.map(record => record.id), library.workspaces.map(record => record.id));
  const moved = moveWorkspace(library, 'core-blueprint', 'up');
  assert.deepEqual(moved.workspaces.map(record => record.id), ['core-blueprint', 'example-workspace', 'client']);
});

test('workspace removal requires a non-active target and preserves an available workspace', () => {
  const library = createWorkspaceLibrary(cloneDefaultProfile());
  assert.throws(() => removeWorkspace(library, library.active_workspace_id), /active workspace cannot be removed/);
  const second = createEmptyProfile();
  second.profile.id = 'archive-me';
  second.profile.name = 'Archive Me';
  const expanded = addWorkspace(library, second);
  assert.throws(() => removeWorkspace(expanded, 'archive-me'), /must be archived before it can be removed/);
  const archived = setWorkspaceArchived(expanded, 'archive-me', true);
  const removed = removeWorkspace(archived, 'archive-me');
  assert.equal(removed.workspaces.length, 1);
  assert.equal(removed.active_workspace_id, 'example-workspace');
});
