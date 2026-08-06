import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile} from '../src/services/default-profile.js';
import {createUniqueTileId, moveWorkspaceItem, moveWorkspaceItemToTab, removeWorkspaceItem, setWorkspaceItemGovernance, sortWorkspaceItems, upsertWorkspaceItem} from '../src/services/workspace-items.js';
import {validateProfile} from '../src/services/profile-contract.js';

test('unique IDs remain stable and avoid duplicates across sections', () => {
  const profile = cloneDefaultProfile();
  assert.equal(createUniqueTileId('New Portal', profile.sections), 'new-portal');
  profile.sections.web_apps.push({id:'new-portal'});
  assert.equal(createUniqueTileId('New Portal', profile.sections), 'new-portal-2');
});

test('adding and editing items preserves a normalised order', () => {
  const profile = cloneDefaultProfile();
  const added = upsertWorkspaceItem(profile, 'web_apps', {id:'support-site', type:'web', tab_id:'general', title:'Support', subtitle:'Portal', url:'https://example.com/support', position:99, enabled:true});
  assert.equal(added.sections.web_apps.length, profile.sections.web_apps.length + 1);
  assert.deepEqual(sortWorkspaceItems(added.sections.web_apps).map(item => item.position), [1,2,3,4,5]);
  const edited = upsertWorkspaceItem(added, 'web_apps', {...added.sections.web_apps[0], title:'Accounting portal'});
  assert.equal(edited.sections.web_apps.find(item => item.id === 'accounting').title, 'Accounting portal');
  assert.equal(edited.profile.source, 'local');
});

test('moving and removing items is deterministic', () => {
  const profile = cloneDefaultProfile();
  const moved = moveWorkspaceItem(profile, 'apps', 'documents', 'up');
  assert.deepEqual(sortWorkspaceItems(moved.sections.apps).slice(0,2).map(item => item.id), ['documents','email']);
  const removed = removeWorkspaceItem(moved, 'apps', 'documents');
  assert.equal(removed.sections.apps.some(item => item.id === 'documents'), false);
  assert.deepEqual(sortWorkspaceItems(removed.sections.apps).map(item => item.position), [1,2,3,4,5]);
});


test('managed items reject ordinary edits, moves and removal', () => {
  const profile = cloneDefaultProfile();
  const managed = setWorkspaceItemGovernance(profile, 'apps', 'documents', {origin:'organisation', locked:true});
  assert.throws(() => upsertWorkspaceItem(managed, 'apps', {...managed.sections.apps[1], title:'Changed'}), /cannot be changed locally/);
  assert.throws(() => moveWorkspaceItem(managed, 'apps', 'documents', 'up'), /cannot be changed locally/);
  assert.throws(() => removeWorkspaceItem(managed, 'apps', 'documents'), /cannot be changed locally/);
});

test('governance control can intentionally unlock a managed item', () => {
  const profile = cloneDefaultProfile();
  const managed = setWorkspaceItemGovernance(profile, 'apps', 'documents', {origin:'organisation', locked:true});
  const unlocked = setWorkspaceItemGovernance(managed, 'apps', 'documents', {origin:'local', locked:false});
  assert.equal(unlocked.sections.apps.find(item => item.id === 'documents').locked, false);
});


test('item ordering is scoped to the tab that contains the item', () => {
  const profile = cloneDefaultProfile();
  profile.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:2, is_default:false});
  profile.sections.apps[0].tab_id = 'design';
  profile.sections.apps[0].position = 1;
  profile.sections.apps[1].tab_id = 'design';
  profile.sections.apps[1].position = 2;
  const moved = moveWorkspaceItem(profile, 'apps', 'documents', 'up');
  const design = sortWorkspaceItems(moved.sections.apps.filter(item => item.tab_id === 'design'));
  const general = sortWorkspaceItems(moved.sections.apps.filter(item => item.tab_id === 'general'));
  assert.deepEqual(design.map(item => item.id), ['documents', 'email']);
  assert.deepEqual(general.map(item => item.id), ['calendar', 'passwords', 'scanning', 'meetings']);
});


test('normalising after an edit preserves a previously saved tab order', () => {
  let profile = cloneDefaultProfile();
  profile = moveWorkspaceItem(profile, 'apps', 'documents', 'up');
  const movedOrder = sortWorkspaceItems(profile.sections.apps.filter(item => item.tab_id === 'general')).map(item => item.id);
  assert.deepEqual(movedOrder.slice(0, 2), ['documents', 'email']);

  const edited = {...profile.sections.apps.find(item => item.id === 'email'), title:'Email inbox'};
  profile = upsertWorkspaceItem(profile, 'apps', edited);
  const afterEdit = sortWorkspaceItems(profile.sections.apps.filter(item => item.tab_id === 'general')).map(item => item.id);
  assert.deepEqual(afterEdit.slice(0, 2), ['documents', 'email']);
});


test('moving an item to another tab preserves metadata and normalises both tab orders', () => {
  const profile = cloneDefaultProfile();
  profile.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:2, is_default:false});
  profile.sections.apps[5].tab_id = 'design';
  profile.sections.apps[5].position = 99;

  const originalItem = structuredClone(profile.sections.apps.find(item => item.id === 'documents'));
  const unchangedProfile = structuredClone(profile);
  const moved = moveWorkspaceItemToTab(profile, 'apps', 'documents', 'design');
  const movedItem = moved.sections.apps.find(item => item.id === 'documents');

  assert.deepEqual(profile, unchangedProfile, 'the input profile must remain immutable');
  assert.equal(movedItem.tab_id, 'design');
  assert.equal(movedItem.position, 2);
  assert.deepEqual(
    {...movedItem, tab_id: originalItem.tab_id, position: originalItem.position},
    originalItem,
    'only tab_id and position may change'
  );
  assert.deepEqual(
    sortWorkspaceItems(moved.sections.apps.filter(item => item.tab_id === 'general')).map(item => item.position),
    [1, 2, 3, 4]
  );
  assert.deepEqual(
    sortWorkspaceItems(moved.sections.apps.filter(item => item.tab_id === 'design')).map(item => [item.id, item.position]),
    [['meetings', 1], ['documents', 2]]
  );
  assert.equal(moved.profile.source, 'local');
  assert.doesNotThrow(() => validateProfile(moved));
});

test('moving an item to a tab is fail-closed for invalid or protected mutations', () => {
  const profile = cloneDefaultProfile();
  profile.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:2, is_default:false});

  assert.throws(() => moveWorkspaceItemToTab(profile, 'unknown', 'documents', 'design'), /Unknown workspace section/);
  assert.throws(() => moveWorkspaceItemToTab(profile, 'help_support', 'guide', 'general'), /does not support tabs/);
  assert.throws(() => moveWorkspaceItemToTab(profile, 'apps', 'missing', 'design'), /Workspace item not found/);
  assert.throws(() => moveWorkspaceItemToTab(profile, 'apps', 'documents', 'missing'), /Unknown tab id/);
  assert.throws(() => moveWorkspaceItemToTab(profile, 'apps', 'documents', 'general'), /already in the selected tab/);

  const managed = setWorkspaceItemGovernance(profile, 'apps', 'documents', {origin:'organisation', locked:true});
  assert.throws(() => moveWorkspaceItemToTab(managed, 'apps', 'documents', 'design'), /cannot be changed locally/);
});

test('moving between tabs does not alter unrelated sections or tabs', () => {
  const profile = cloneDefaultProfile();
  profile.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:2, is_default:false});
  profile.settings.section_tabs.apps.tabs.push({id:'admin', title:'Admin', position:3, is_default:false});
  profile.sections.apps[4].tab_id = 'admin';
  profile.sections.apps[4].position = 1;

  const webAppsBefore = structuredClone(profile.sections.web_apps);
  const adminBefore = structuredClone(profile.sections.apps.filter(item => item.tab_id === 'admin'));
  const tabsBefore = structuredClone(profile.settings.section_tabs.apps);
  const moved = moveWorkspaceItemToTab(profile, 'apps', 'documents', 'design');

  assert.deepEqual(moved.sections.web_apps, webAppsBefore);
  assert.deepEqual(moved.sections.apps.filter(item => item.tab_id === 'admin'), adminBefore);
  assert.deepEqual(moved.settings.section_tabs.apps, tabsBefore);
});
