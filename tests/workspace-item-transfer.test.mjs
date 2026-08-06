import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {addWorkspace, createWorkspaceLibrary, setWorkspaceArchived, validateWorkspaceLibrary} from '../src/services/workspace-library-contract.js';
import {setWorkspaceItemGovernance} from '../src/services/workspace-items.js';
import {buildWorkspaceItemTransferPlan, transferWorkspaceItem, workspaceTransferDestinations} from '../src/services/workspace-item-transfer.js';

function fixture() {
  const source = cloneDefaultProfile();
  source.profile.id = 'source';
  source.profile.name = 'Client';
  source.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:2, is_default:false});
  source.sections.apps[5].tab_id = 'design';
  source.sections.apps[5].position = 1;

  const destination = createEmptyProfile();
  destination.profile.id = 'destination';
  destination.profile.name = 'Client';
  destination.settings.section_tabs.apps.tabs.push({id:'work', title:'Work', position:2, is_default:false});
  destination.sections.apps.push({
    id:'existing', type:'application', tab_id:'work', title:'Existing', subtitle:'', desktop_id:'org.example.Existing.desktop',
    application_source:'unknown', icon_name:'application-x-executable-symbolic', icon_override:'inherit', position:1,
    enabled:true, origin:'local', locked:false,
  });
  return addWorkspace(createWorkspaceLibrary(source), destination);
}

function request(overrides = {}) {
  return {
    sourceWorkspaceId:'source',
    destinationWorkspaceId:'destination',
    sectionName:'apps',
    sourceItemId:'documents',
    destinationTabId:'work',
    mode:'copy',
    ...overrides,
  };
}

test('copy is deeply immutable, independent and creates a new destination ID', () => {
  const library = fixture();
  const before = structuredClone(library);
  const result = transferWorkspaceItem(library, request());
  assert.deepEqual(library, before);
  assert.notEqual(result.metadata.resultingItemId, 'documents');
  const sourceItem = result.candidateLibrary.workspaces[0].profile.sections.apps.find(item => item.id === 'documents');
  const destinationItem = result.candidateLibrary.workspaces[1].profile.sections.apps.find(item => item.id === result.metadata.resultingItemId);
  assert.ok(sourceItem);
  assert.ok(destinationItem);
  assert.notStrictEqual(destinationItem, sourceItem);
  assert.notStrictEqual(result.candidateLibrary, library);
  assert.notStrictEqual(result.candidateLibrary.workspaces[0].profile, library.workspaces[0].profile);
  destinationItem.title = 'Changed copy';
  destinationItem.icon_override = 'dashboard';
  assert.equal(sourceItem.title, 'Documents');
  assert.notEqual(sourceItem.icon_override, destinationItem.icon_override);
  assert.doesNotThrow(() => validateWorkspaceLibrary(result.candidateLibrary));
});

test('move preserves a collision-free ID and removes only the source item', () => {
  const library = fixture();
  const unrelatedBefore = structuredClone(library.workspaces[0].profile.sections.web_apps);
  const result = transferWorkspaceItem(library, request({mode:'move'}));
  assert.equal(result.metadata.resultingItemId, 'documents');
  assert.equal(result.candidateLibrary.workspaces[0].profile.sections.apps.some(item => item.id === 'documents'), false);
  assert.equal(result.candidateLibrary.workspaces[1].profile.sections.apps.some(item => item.id === 'documents'), true);
  assert.deepEqual(result.candidateLibrary.workspaces[0].profile.sections.web_apps, unrelatedBefore);
  assert.equal(result.candidateLibrary.active_workspace_id, library.active_workspace_id);
  assert.deepEqual(result.candidateLibrary.application_settings, library.application_settings);
});

test('move resolves collisions across the complete destination profile', () => {
  const library = fixture();
  library.workspaces[1].profile.sections.web_apps.push({
    id:'documents', type:'web', tab_id:'general', title:'Documents portal', subtitle:'', url:'https://example.com',
    icon_name:'web-browser-symbolic', icon_role:'web', position:1, enabled:true, origin:'local', locked:false,
  });
  const result = transferWorkspaceItem(library, request({mode:'move'}));
  assert.equal(result.metadata.originalItemId, 'documents');
  assert.equal(result.metadata.resultingItemId, 'documents-copy');
  assert.equal(result.candidateLibrary.workspaces[1].profile.sections.web_apps.some(item => item.id === 'documents'), true);
});

test('ID generation is injectable, collision-checked and bounded', () => {
  const library = fixture();
  library.workspaces[1].profile.sections.apps.push({
    ...structuredClone(library.workspaces[1].profile.sections.apps[0]), id:'forced-id', position:2,
  });
  const attempts = [];
  const result = transferWorkspaceItem(library, request(), {
    idGenerator: ({attempt}) => { attempts.push(attempt); return attempt === 1 ? 'forced-id' : 'safe-id'; },
  });
  assert.equal(result.metadata.resultingItemId, 'safe-id');
  assert.deepEqual(attempts, [1,2]);
  assert.throws(() => transferWorkspaceItem(library, request(), {
    idGenerator: () => 'forced-id', maximumIdAttempts: 2,
  }), /Unable to generate a safe unique workspace item id/);
});

test('only affected source and destination collections are normalised', () => {
  const library = fixture();
  const sourceAdmin = library.workspaces[0].profile.sections.apps.find(item => item.id === 'meetings');
  const sourceAdminBefore = structuredClone(sourceAdmin);
  const destinationGeneralBefore = structuredClone(library.workspaces[1].profile.sections.apps.filter(item => item.tab_id === 'general'));
  const result = transferWorkspaceItem(library, request({mode:'move'}));
  const sourceProfile = result.candidateLibrary.workspaces[0].profile;
  const destinationProfile = result.candidateLibrary.workspaces[1].profile;
  assert.deepEqual(sourceProfile.sections.apps.find(item => item.id === 'meetings'), sourceAdminBefore);
  assert.deepEqual(destinationProfile.sections.apps.filter(item => item.tab_id === 'general'), destinationGeneralBefore);
  assert.deepEqual(sourceProfile.sections.apps.filter(item => item.tab_id === 'general').map(item => item.position).sort((a,b)=>a-b), [1,2,3,4]);
  assert.deepEqual(destinationProfile.sections.apps.filter(item => item.tab_id === 'work').map(item => item.position).sort((a,b)=>a-b), [1,2]);
});

test('Help and support transfers without a tab choice', () => {
  const library = fixture();
  const result = transferWorkspaceItem(library, request({
    sectionName:'help_support', sourceItemId:'guide', destinationTabId:null, mode:'copy',
  }));
  assert.equal(result.metadata.sourceTabId, null);
  assert.equal(result.metadata.destinationTabId, null);
  assert.equal(result.candidateLibrary.workspaces[1].profile.sections.help_support.length, 1);
});

test('all validation failures preserve the input library', () => {
  const cases = [
    request({sourceWorkspaceId:'missing'}),
    request({destinationWorkspaceId:'missing'}),
    request({destinationWorkspaceId:'source'}),
    request({sectionName:'unknown'}),
    request({sourceItemId:'missing'}),
    request({destinationTabId:'missing'}),
    request({mode:'invalid'}),
  ];
  for (const invalid of cases) {
    const library = fixture();
    const before = structuredClone(library);
    assert.throws(() => transferWorkspaceItem(library, invalid));
    assert.deepEqual(library, before);
  }
});

test('archived source, archived destination and managed item fail closed', () => {
  let library = fixture();
  library.active_workspace_id = 'destination';
  library = setWorkspaceArchived(library, 'source', true);
  assert.throws(() => transferWorkspaceItem(library, request()), /source workspace is archived/);

  library = fixture();
  library = setWorkspaceArchived(library, 'destination', true);
  assert.throws(() => transferWorkspaceItem(library, request()), /destination workspace is archived/);

  library = fixture();
  library.workspaces[0].profile = setWorkspaceItemGovernance(library.workspaces[0].profile, 'apps', 'documents', {origin:'organisation', locked:true});
  assert.throws(() => transferWorkspaceItem(library, request()), /managed by the organisation/);
});

test('destination capacity rejects without mutation', () => {
  const library = fixture();
  const destination = library.workspaces[1].profile;
  const template = destination.sections.help_support[0] ?? {
    type:'action', title:'Support', subtitle:'', action:'support', icon_name:'help-browser-symbolic', enabled:true, origin:'local', locked:false,
  };
  for (let i = 0; i < 499; i += 1)
    destination.sections.help_support.push({...structuredClone(template), id:`capacity-${i}`, position:i+1});
  const before = structuredClone(library);
  assert.throws(() => transferWorkspaceItem(library, request()), /too many items/);
  assert.deepEqual(library, before);
});

test('allowed profile mutations are limited to collections and local source metadata', () => {
  const library = fixture();
  const result = transferWorkspaceItem(library, request({mode:'move'}));
  for (const [before, after] of [
    [library.workspaces[0].profile, result.candidateLibrary.workspaces[0].profile],
    [library.workspaces[1].profile, result.candidateLibrary.workspaces[1].profile],
  ]) {
    const beforeClone = structuredClone(before);
    const afterClone = structuredClone(after);
    delete beforeClone.sections;
    delete afterClone.sections;
    beforeClone.profile.source = 'local';
    assert.deepEqual(afterClone, beforeClone);
  }
});

test('workspace destination labels disambiguate duplicate names while preserving stable IDs', () => {
  const library = fixture();
  const third = createEmptyProfile();
  third.profile.id = 'third';
  third.profile.name = 'Client';
  const expanded = addWorkspace(library, third);
  const destinations = workspaceTransferDestinations(expanded, 'source', 'apps');
  assert.deepEqual(destinations.map(item => item.id), ['destination','third']);
  assert.ok(destinations.every(item => item.displayName.includes(item.id)));
  assert.deepEqual(destinations[0].tabs.map(tab => tab.id), ['general','work']);
});


test('copy plan creates only a destination pre-mutation restorepoint and destination history', () => {
  const library = fixture();
  const plan = buildWorkspaceItemTransferPlan(library, request());
  assert.equal(plan.restorePoints.length, 1);
  assert.equal(plan.restorePoints[0].workspaceId, 'destination');
  assert.deepEqual(plan.restorePoints[0].profile, library.workspaces[1].profile);
  assert.equal(plan.historyRecords.length, 1);
  assert.equal(plan.historyRecords[0].workspaceId, 'destination');
  assert.equal(plan.historyRecords[0].event.action, 'item-copied-from-workspace');
  assert.deepEqual(plan.historyRecords[0].event.details, {
    operation:'copy', source_workspace_id:'source', destination_workspace_id:'destination', section_id:'apps',
    source_tab_id:'general', destination_tab_id:'work', original_item_id:'documents', resulting_item_id:plan.metadata.resultingItemId,
  });
});

test('move plan creates source then destination pre-mutation restorepoints and two histories', () => {
  const library = fixture();
  const plan = buildWorkspaceItemTransferPlan(library, request({mode:'move'}));
  assert.deepEqual(plan.restorePoints.map(item => item.workspaceId), ['source','destination']);
  assert.deepEqual(plan.restorePoints[0].profile, library.workspaces[0].profile);
  assert.deepEqual(plan.restorePoints[1].profile, library.workspaces[1].profile);
  assert.deepEqual(plan.historyRecords.map(item => item.workspaceId), ['source','destination']);
  assert.deepEqual(plan.historyRecords.map(item => item.event.action), [
    'item-moved-out-of-workspace', 'item-moved-into-workspace',
  ]);
  for (const record of plan.historyRecords) {
    assert.equal(record.event.details.original_item_id, 'documents');
    assert.equal(record.event.details.resulting_item_id, 'documents');
    assert.equal(record.event.details.operation, 'move');
  }
});

test('unrelated third workspace and unrelated profile structures remain structurally equal', () => {
  const library = fixture();
  const third = createEmptyProfile();
  third.profile.id = 'third';
  third.profile.name = 'Unrelated';
  const expanded = addWorkspace(library, third);
  const thirdBefore = structuredClone(expanded.workspaces[2]);
  const sourceSettingsBefore = structuredClone(expanded.workspaces[0].profile.settings);
  const destinationStatusBefore = structuredClone(expanded.workspaces[1].profile.status);
  const result = transferWorkspaceItem(expanded, request({mode:'move'}));
  assert.deepEqual(result.candidateLibrary.workspaces[2], thirdBefore);
  assert.deepEqual(result.candidateLibrary.workspaces[0].profile.settings, sourceSettingsBefore);
  assert.deepEqual(result.candidateLibrary.workspaces[1].profile.status, destinationStatusBefore);
  assert.deepEqual(result.candidateLibrary.workspaces.map(item => item.id), expanded.workspaces.map(item => item.id));
});

test('final service validation rejects stale dialog selections after rename, archive, removal or tab removal', () => {
  let library = fixture();
  library.workspaces[1].profile.profile.name = 'Renamed while open';
  assert.doesNotThrow(() => transferWorkspaceItem(library, request()));

  library = fixture();
  library.workspaces[1].archived = true;
  assert.throws(() => transferWorkspaceItem(library, request()), /destination workspace is archived/);

  library = fixture();
  library.workspaces = library.workspaces.filter(item => item.id !== 'destination');
  assert.throws(() => transferWorkspaceItem(library, request()), /Unknown destination workspace id/);

  library = fixture();
  const tabState = library.workspaces[1].profile.settings.section_tabs.apps;
  tabState.tabs = tabState.tabs.filter(tab => tab.id !== 'work');
  library.workspaces[1].profile.sections.apps = library.workspaces[1].profile.sections.apps.filter(item => item.tab_id !== 'work');
  assert.throws(() => transferWorkspaceItem(library, request()), /Unknown destination tab id/);
});
