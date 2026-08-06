import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile} from '../src/services/default-profile.js';
import {
  DEFAULT_SECTION_TAB_ID,
  TABBED_SECTION_NAMES,
  activeSectionTabId,
  addSectionTab,
  createUniqueSectionTabId,
  moveSectionTab,
  removeSectionTab,
  renameSectionTab,
  reorderSectionTabs,
  sectionItemsForTab,
  sectionTabDisplayTitle,
  sectionTabs,
  setActiveSectionTab,
} from '../src/services/section-tabs.js';
import {validateProfile} from '../src/services/profile-contract.js';

test('all tabbed sections start with one visible General tab', () => {
  const profile = cloneDefaultProfile();
  for (const sectionName of TABBED_SECTION_NAMES) {
    const tabs = sectionTabs(profile, sectionName);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].id, DEFAULT_SECTION_TAB_ID);
    assert.equal(tabs[0].is_default, true);
    assert.equal(activeSectionTabId(profile, sectionName), DEFAULT_SECTION_TAB_ID);
    assert.equal(sectionTabDisplayTitle(tabs[0], key => key === 'general_tab' ? 'Algemeen' : key), 'Algemeen');
  }
});

test('adding a tab creates a stable unique id and activates it', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['general', 'design']);
  assert.equal(activeSectionTabId(profile, 'apps'), 'design');
  assert.throws(() => addSectionTab(profile, 'apps', 'design'), /already exists/);
  profile = addSectionTab(profile, 'apps', 'Design Studio');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['general', 'design', 'design-studio']);
  assert.equal(validateProfile(profile), profile);
});

test('active tabs are independent for every section', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Office');
  profile = addSectionTab(profile, 'web_apps', 'Portals');
  profile = setActiveSectionTab(profile, 'apps', 'general');
  assert.equal(activeSectionTabId(profile, 'apps'), 'general');
  assert.equal(activeSectionTabId(profile, 'web_apps'), 'portals');
});

test('items are filtered by their section tab', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  profile.sections.apps[0].tab_id = 'design';
  assert.equal(sectionItemsForTab(profile, 'apps', 'design').length, 1);
  assert.equal(sectionItemsForTab(profile, 'apps', 'general').length, 5);
});

test('unsupported sections and unknown tab ids fail closed', () => {
  const profile = cloneDefaultProfile();
  assert.throws(() => addSectionTab(profile, 'help_support', 'Guides'), /does not support tabs/);
  assert.throws(() => setActiveSectionTab(profile, 'apps', 'missing'), /Unknown tab id/);
});

test('unique tab ids are deterministic and do not depend on translated labels', () => {
  assert.equal(createUniqueSectionTabId('Core Blueprint', [{id:'general'}]), 'core-blueprint');
  assert.equal(createUniqueSectionTabId('Core Blueprint', [{id:'core-blueprint'}]), 'core-blueprint-2');
});


test('tab order is persisted by stable tab ids', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  profile = addSectionTab(profile, 'apps', 'Office');
  profile = reorderSectionTabs(profile, 'apps', ['office', 'general', 'design']);
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['office', 'general', 'design']);
});

test('custom tabs can be deleted safely and non-empty tabs require a destination', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  profile = removeSectionTab(profile, 'apps', 'design');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['general']);
  assert.throws(() => removeSectionTab(profile, 'apps', 'general'), /last remaining|default tab/);

  profile = addSectionTab(profile, 'apps', 'Office');
  profile.sections.apps[0].tab_id = 'office';
  assert.throws(() => removeSectionTab(profile, 'apps', 'office'), /Choose another tab/);
  profile = removeSectionTab(profile, 'apps', 'office', {moveItemsToTabId:'general'});
  assert.equal(profile.sections.apps[0].tab_id, 'general');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['general']);

  profile = addSectionTab(profile, 'apps', 'Managed');
  profile.sections.apps[0].tab_id = 'managed';
  profile.sections.apps[0].locked = true;
  assert.throws(() => removeSectionTab(profile, 'apps', 'managed', {moveItemsToTabId:'general'}), /managed items/);
});


test('a section cannot exceed the bounded tab limit', () => {
  let profile = cloneDefaultProfile();
  for (let index = 2; index <= 20; index += 1)
    profile = addSectionTab(profile, 'apps', `Tab ${index}`, {activate:false});
  assert.equal(sectionTabs(profile, 'apps').length, 20);
  assert.throws(() => addSectionTab(profile, 'apps', 'Tab 21'), /at most 20 tabs/);
});


test('tab names are bounded and duplicate labels are rejected', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  assert.throws(() => addSectionTab(profile, 'apps', ' DESIGN '), /already exists/);
  assert.throws(() => addSectionTab(profile, 'apps', 'x'.repeat(81)), /at most 80 characters/);
});


test('tabs can be renamed without changing their stable ids', () => {
  let profile = cloneDefaultProfile();
  profile = renameSectionTab(profile, 'apps', 'general', 'Daily work');
  assert.equal(sectionTabs(profile, 'apps')[0].id, 'general');
  assert.equal(sectionTabDisplayTitle(sectionTabs(profile, 'apps')[0], () => 'Algemeen'), 'Daily work');
  profile = addSectionTab(profile, 'apps', 'Design');
  assert.throws(() => renameSectionTab(profile, 'apps', 'design', ' daily work '), /already exists/);
  profile = renameSectionTab(profile, 'apps', 'design', 'Creative');
  assert.equal(sectionTabs(profile, 'apps')[1].title, 'Creative');
  assert.equal(validateProfile(profile), profile);
});

test('tabs can move earlier or later through the same stable ordering contract', () => {
  let profile = cloneDefaultProfile();
  profile = addSectionTab(profile, 'apps', 'Design');
  profile = addSectionTab(profile, 'apps', 'Office');
  profile = moveSectionTab(profile, 'apps', 'office', 'earlier');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['general', 'office', 'design']);
  profile = moveSectionTab(profile, 'apps', 'general', 'later');
  assert.deepEqual(sectionTabs(profile, 'apps').map(tab => tab.id), ['office', 'general', 'design']);
  assert.throws(() => moveSectionTab(profile, 'apps', 'office', 'earlier'), /cannot be moved/);
});
