import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile} from '../src/services/default-profile.js';
import {mergeProfileUpdate} from '../src/services/profile-three-way-merge.js';

test('independent queued changes merge onto the latest profile', () => {
  const baseline = cloneDefaultProfile();
  const desired = structuredClone(baseline);
  desired.settings.icon_style = 'system';
  const latest = structuredClone(baseline);
  latest.settings.section_tabs.apps.active_tab_id = 'general';
  latest.profile.organisation = 'Latest organisation';

  const merged = mergeProfileUpdate(baseline, desired, latest);
  assert.equal(merged.settings.icon_style, 'system');
  assert.equal(merged.profile.organisation, 'Latest organisation');
  assert.deepEqual(baseline, cloneDefaultProfile());
});

test('same-value concurrent updates remain valid', () => {
  const baseline = cloneDefaultProfile();
  const desired = structuredClone(baseline);
  const latest = structuredClone(baseline);
  desired.profile.name = 'Shared';
  latest.profile.name = 'Shared';
  assert.equal(mergeProfileUpdate(baseline, desired, latest).profile.name, 'Shared');
});

test('conflicting writes to the same scalar fail closed', () => {
  const baseline = cloneDefaultProfile();
  const desired = structuredClone(baseline);
  const latest = structuredClone(baseline);
  desired.profile.name = 'Desired';
  latest.profile.name = 'Latest';
  assert.throws(() => mergeProfileUpdate(baseline, desired, latest), /changed concurrently at profile\.profile\.name/);
});

test('conflicting writes to the same item collection fail closed', () => {
  const baseline = cloneDefaultProfile();
  const desired = structuredClone(baseline);
  const latest = structuredClone(baseline);
  desired.sections.apps[0].title = 'Desired title';
  latest.sections.apps[0].title = 'Latest title';
  assert.throws(() => mergeProfileUpdate(baseline, desired, latest), /changed concurrently at profile\.sections\.apps/);
});

test('returned data is deeply independent from all inputs', () => {
  const baseline = cloneDefaultProfile();
  const desired = structuredClone(baseline);
  const latest = structuredClone(baseline);
  desired.profile.organisation = 'Organisation';
  const merged = mergeProfileUpdate(baseline, desired, latest);
  merged.sections.apps[0].title = 'Changed later';
  assert.notEqual(baseline.sections.apps[0].title, 'Changed later');
  assert.notEqual(desired.sections.apps[0].title, 'Changed later');
  assert.notEqual(latest.sections.apps[0].title, 'Changed later');
});
