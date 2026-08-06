import {MAX_PROFILE_TILES, PROFILE_SECTION_NAMES, PROFILE_TABBED_SECTION_NAMES, markProfileLocallyModified} from './profile-contract.js';
import {validateWorkspaceLibrary, workspaceProfile} from './workspace-library-contract.js';
import {createCollisionSafeTileId} from './workspace-items.js';

const SECTION_SET = new Set(PROFILE_SECTION_NAMES);
const TABBED_SECTION_SET = new Set(PROFILE_TABBED_SECTION_NAMES);
const MODE_SET = new Set(['copy', 'move']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function workspaceRecord(library, workspaceId, role) {
  const record = library.workspaces.find(entry => entry.id === workspaceId);
  assert(record, `Unknown ${role} workspace id: ${workspaceId}`);
  assert(!record.archived, `The ${role} workspace is archived and cannot be changed`);
  return record;
}

function collectionFor(profile, sectionName) {
  const collection = profile.sections?.[sectionName];
  assert(Array.isArray(collection), `Unknown workspace section: ${sectionName}`);
  return collection;
}

function assertDestinationTab(profile, sectionName, destinationTabId) {
  if (!TABBED_SECTION_SET.has(sectionName)) {
    assert(destinationTabId === null || destinationTabId === undefined, 'This section does not accept a destination tab');
    return null;
  }
  assert(typeof destinationTabId === 'string' && destinationTabId.length > 0, 'A destination tab id is required');
  const tabs = profile.settings?.section_tabs?.[sectionName]?.tabs;
  assert(Array.isArray(tabs) && tabs.some(tab => tab.id === destinationTabId), `Unknown destination tab id for ${sectionName}: ${destinationTabId}`);
  return destinationTabId;
}

function normaliseChangedCollection(items, tabId) {
  const matching = items
    .map((item, storageIndex) => ({item, storageIndex}))
    .filter(({item}) => (item.tab_id ?? null) === tabId)
    .sort((left, right) => (left.item.position ?? 0) - (right.item.position ?? 0) || left.storageIndex - right.storageIndex);
  matching.forEach(({item}, index) => {
    item.position = index + 1;
  });
}

function totalItems(profile) {
  return PROFILE_SECTION_NAMES.reduce((sum, sectionName) => sum + profile.sections[sectionName].length, 0);
}

function finalItemId(mode, sourceItem, destinationProfile, idGenerator, maximumIdAttempts) {
  const destinationIds = new Set(Object.values(destinationProfile.sections).flat().map(item => item.id));
  if (mode === 'move' && !destinationIds.has(sourceItem.id))
    return sourceItem.id;
  return createCollisionSafeTileId(sourceItem.id, destinationProfile.sections, {
    generator: idGenerator,
    maximumAttempts: maximumIdAttempts,
  });
}

export function transferWorkspaceItem(library, {
  sourceWorkspaceId,
  destinationWorkspaceId,
  sectionName,
  sourceItemId,
  destinationTabId = null,
  mode,
}, {
  idGenerator = null,
  maximumIdAttempts = 100,
} = {}) {
  validateWorkspaceLibrary(library);
  assert(MODE_SET.has(mode), `Unsupported workspace item transfer mode: ${mode}`);
  assert(SECTION_SET.has(sectionName), `Unknown workspace section: ${sectionName}`);
  assert(sourceWorkspaceId !== destinationWorkspaceId, 'Source and destination workspace must be different');

  const originalSource = workspaceRecord(library, sourceWorkspaceId, 'source');
  const originalDestination = workspaceRecord(library, destinationWorkspaceId, 'destination');
  const originalItems = collectionFor(originalSource.profile, sectionName);
  const originalItem = originalItems.find(item => item.id === sourceItemId);
  assert(originalItem, `Workspace item not found: ${sourceItemId}`);
  assert(!originalItem.locked, 'This item is managed by the organisation and cannot be changed locally');
  const sourceTabId = TABBED_SECTION_SET.has(sectionName) ? originalItem.tab_id : null;
  const validatedDestinationTabId = assertDestinationTab(originalDestination.profile, sectionName, destinationTabId);
  assert(totalItems(originalDestination.profile) < MAX_PROFILE_TILES, `Destination workspace contains too many items (maximum ${MAX_PROFILE_TILES})`);

  const candidateLibrary = clone(library);
  const source = workspaceRecord(candidateLibrary, sourceWorkspaceId, 'source');
  const destination = workspaceRecord(candidateLibrary, destinationWorkspaceId, 'destination');
  const sourceItems = collectionFor(source.profile, sectionName);
  const destinationItems = collectionFor(destination.profile, sectionName);
  const sourceIndex = sourceItems.findIndex(item => item.id === sourceItemId);
  assert(sourceIndex >= 0, `Workspace item not found: ${sourceItemId}`);
  const sourceItem = sourceItems[sourceIndex];
  assert(!sourceItem.locked, 'This item is managed by the organisation and cannot be changed locally');

  const resultingItemId = finalItemId(mode, sourceItem, destination.profile, idGenerator, maximumIdAttempts);
  const destinationItem = clone(sourceItem);
  destinationItem.id = resultingItemId;
  if (TABBED_SECTION_SET.has(sectionName))
    destinationItem.tab_id = validatedDestinationTabId;
  else
    delete destinationItem.tab_id;
  destinationItem.position = destinationItems.filter(item => (item.tab_id ?? null) === validatedDestinationTabId).length + 1;
  destinationItems.push(destinationItem);
  normaliseChangedCollection(destinationItems, validatedDestinationTabId);
  markProfileLocallyModified(destination.profile);

  if (mode === 'move') {
    sourceItems.splice(sourceIndex, 1);
    normaliseChangedCollection(sourceItems, sourceTabId);
    markProfileLocallyModified(source.profile);
  }

  validateWorkspaceLibrary(candidateLibrary);
  return {
    candidateLibrary,
    metadata: {
      operation: mode,
      sourceWorkspaceId,
      destinationWorkspaceId,
      sectionName,
      sourceTabId,
      destinationTabId: validatedDestinationTabId,
      originalItemId: sourceItemId,
      resultingItemId,
      itemTitle: sourceItem.title,
    },
    preMutationProfiles: {
      source: clone(originalSource.profile),
      destination: clone(originalDestination.profile),
    },
  };
}

export function workspaceTransferDestinations(library, sourceWorkspaceId, sectionName) {
  validateWorkspaceLibrary(library);
  assert(SECTION_SET.has(sectionName), `Unknown workspace section: ${sectionName}`);
  const source = workspaceRecord(library, sourceWorkspaceId, 'source');
  void source;
  const duplicateNames = new Map();
  for (const record of library.workspaces) {
    if (record.archived || record.id === sourceWorkspaceId)
      continue;
    const name = record.profile.profile.name;
    duplicateNames.set(name, (duplicateNames.get(name) ?? 0) + 1);
  }
  return library.workspaces
    .filter(record => !record.archived && record.id !== sourceWorkspaceId)
    .map(record => ({
      id: record.id,
      name: record.profile.profile.name,
      displayName: duplicateNames.get(record.profile.profile.name) > 1
        ? `${record.profile.profile.name} — ${record.id}`
        : record.profile.profile.name,
      tabs: TABBED_SECTION_SET.has(sectionName)
        ? record.profile.settings.section_tabs[sectionName].tabs
          .slice()
          .sort((a, b) => a.position - b.position)
          .map(tab => ({id: tab.id, title: tab.title, isDefault: tab.is_default}))
        : [],
    }));
}


export function buildWorkspaceItemTransferPlan(library, request, options = {}) {
  const transfer = transferWorkspaceItem(library, request, options);
  const sourceAfter = workspaceProfile(transfer.candidateLibrary, transfer.metadata.sourceWorkspaceId);
  const destinationAfter = workspaceProfile(transfer.candidateLibrary, transfer.metadata.destinationWorkspaceId);
  const details = {
    operation: transfer.metadata.operation,
    source_workspace_id: transfer.metadata.sourceWorkspaceId,
    destination_workspace_id: transfer.metadata.destinationWorkspaceId,
    section_id: transfer.metadata.sectionName,
    source_tab_id: transfer.metadata.sourceTabId,
    destination_tab_id: transfer.metadata.destinationTabId,
    original_item_id: transfer.metadata.originalItemId,
    resulting_item_id: transfer.metadata.resultingItemId,
  };
  const restorePoints = request.mode === 'copy'
    ? [{workspaceId: transfer.metadata.destinationWorkspaceId, profile: transfer.preMutationProfiles.destination}]
    : [
      {workspaceId: transfer.metadata.sourceWorkspaceId, profile: transfer.preMutationProfiles.source},
      {workspaceId: transfer.metadata.destinationWorkspaceId, profile: transfer.preMutationProfiles.destination},
    ];
  const historyRecords = request.mode === 'copy'
    ? [{
      workspaceId: transfer.metadata.destinationWorkspaceId,
      profile: destinationAfter,
      event: {
        action: 'item-copied-from-workspace',
        summary: `Copied ${transfer.metadata.itemTitle} from another workspace`,
        details,
      },
    }]
    : [
      {
        workspaceId: transfer.metadata.sourceWorkspaceId,
        profile: sourceAfter,
        event: {
          action: 'item-moved-out-of-workspace',
          summary: `Moved ${transfer.metadata.itemTitle} to another workspace`,
          details,
        },
      },
      {
        workspaceId: transfer.metadata.destinationWorkspaceId,
        profile: destinationAfter,
        event: {
          action: 'item-moved-into-workspace',
          summary: `Moved ${transfer.metadata.itemTitle} from another workspace`,
          details,
        },
      },
    ];
  return {
    candidateLibrary: transfer.candidateLibrary,
    restorePoints,
    historyRecords,
    metadata: transfer.metadata,
  };
}
