import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile} from '../src/services/default-profile.js';
import {createHistoryRecord, diffProfiles, governanceLabel, historyForWorkspace} from '../src/services/governance-contract.js';

test('profile diff identifies added, changed and removed items', () => {
  const current = cloneDefaultProfile();
  const candidate = cloneDefaultProfile();
  candidate.sections.apps[0].title = 'Work email';
  candidate.sections.web_apps.pop();
  candidate.sections.files_places.push({id:'archive', type:'place', title:'Archive', subtitle:'', uri:'~/Archive', origin:'local', locked:false, position:6, enabled:true});
  const diff = diffProfiles(current, candidate);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.added.length, 1);
});

test('history records contain governance metadata without technical targets', () => {
  const profile = cloneDefaultProfile();
  const record = createHistoryRecord({action:'item-updated', summary:'Updated Email', profile, timestamp:'2026-08-02T02:00:00+0200', restoreFile:'restore.json', details:{item_id:'email'}});
  assert.equal(record.restore_file, 'restore.json');
  assert.equal(record.profile.id, profile.profile.id);
  assert.equal(JSON.stringify(record).includes('https://'), false);
});

test('governance labels distinguish local and managed items', () => {
  assert.equal(governanceLabel({origin:'local', locked:false}), 'Local item');
  assert.equal(governanceLabel({origin:'organisation', locked:true}), 'Managed by organisation');
});


test('workspace history is isolated by workspace ID with explicit legacy handling', () => {
  const records = [
    {id:'a', details:{workspace_id:'workspace-a'}},
    {id:'b', details:{workspace_id:'core-blueprint'}},
    {id:'legacy', details:{}},
  ];
  assert.deepEqual(historyForWorkspace(records, 'workspace-a').map(record => record.id), ['a']);
  assert.deepEqual(historyForWorkspace(records, 'core-blueprint').map(record => record.id), ['b']);
  assert.deepEqual(historyForWorkspace(records, 'workspace-a', {includeLegacy:true}).map(record => record.id), ['a', 'legacy']);
  assert.deepEqual(historyForWorkspace(null, 'workspace-a'), []);
});
