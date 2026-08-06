import {normaliseProfile, profileSummary, validateProfile} from './profile-contract.js';

export const CURRENT_LIBRARY_SCHEMA_VERSION = 1;
export const WORKSPACE_LIBRARY_FORMAT = 'workspace-hub-library';
export const SUPPORTED_LANGUAGES = Object.freeze(['system', 'en', 'nl', 'de']);

const LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);
const MAX_WORKSPACES = 50;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function legacyLanguage(profile) {
  const language = profile?.settings?.language;
  return LANGUAGE_SET.has(language) ? language : 'system';
}

function workspaceIndex(library, workspaceId) {
  const index = library.workspaces.findIndex(record => record.id === workspaceId);
  assert(index >= 0, `Unknown workspace id: ${workspaceId}`);
  return index;
}

export function createWorkspaceRecord(profile, {archived = false} = {}) {
  const normalised = normaliseProfile(profile);
  return {
    id: normalised.profile.id,
    archived: Boolean(archived),
    profile: normalised,
  };
}

export function createWorkspaceLibrary(profile, {language = 'system'} = {}) {
  assert(LANGUAGE_SET.has(language), 'application_settings.language is unsupported');
  const record = createWorkspaceRecord(profile);
  return validateWorkspaceLibrary({
    format: WORKSPACE_LIBRARY_FORMAT,
    schema_version: CURRENT_LIBRARY_SCHEMA_VERSION,
    active_workspace_id: record.id,
    application_settings: {language},
    workspaces: [record],
  });
}

export function migrateLegacyProfileToLibrary(profile) {
  const language = legacyLanguage(profile);
  return createWorkspaceLibrary(profile, {language});
}

export function normaliseWorkspaceLibrary(value) {
  assert(isObject(value), 'Workspace library must be an object');
  if (value.format === 'workspace-hub-profile')
    return migrateLegacyProfileToLibrary(value);

  const library = clone(value);
  assert(library.format === WORKSPACE_LIBRARY_FORMAT, 'Unsupported workspace library format');
  assert(library.schema_version === CURRENT_LIBRARY_SCHEMA_VERSION, 'Unsupported workspace library schema version');
  library.application_settings = {
    language: LANGUAGE_SET.has(library.application_settings?.language)
      ? library.application_settings.language
      : 'system',
  };
  library.workspaces = (library.workspaces ?? []).map(record => {
    assert(isObject(record), 'Workspace record must be an object');
    const profile = normaliseProfile(record.profile);
    return {
      id: record.id ?? profile.profile.id,
      archived: Boolean(record.archived),
      profile,
    };
  });
  return validateWorkspaceLibrary(library);
}

export function validateWorkspaceLibrary(library) {
  assert(isObject(library), 'Workspace library must be an object');
  assert(library.format === WORKSPACE_LIBRARY_FORMAT, 'Unsupported workspace library format');
  assert(library.schema_version === CURRENT_LIBRARY_SCHEMA_VERSION, 'Unsupported workspace library schema version');
  assert(isObject(library.application_settings), 'application_settings must be an object');
  assert(LANGUAGE_SET.has(library.application_settings.language), 'application_settings.language is unsupported');
  assert(Array.isArray(library.workspaces), 'workspaces must be an array');
  assert(library.workspaces.length > 0, 'Workspace library must contain at least one workspace');
  assert(library.workspaces.length <= MAX_WORKSPACES, `Workspace library contains too many workspaces (maximum ${MAX_WORKSPACES})`);

  const ids = new Set();
  let availableWorkspaceCount = 0;
  for (const [index, record] of library.workspaces.entries()) {
    assert(isObject(record), `workspaces[${index}] must be an object`);
    assert(nonEmptyString(record.id), `workspaces[${index}].id is required`);
    assert(!ids.has(record.id), `Duplicate workspace id: ${record.id}`);
    ids.add(record.id);
    assert(typeof record.archived === 'boolean', `workspaces[${index}].archived must be true or false`);
    if (!record.archived)
      availableWorkspaceCount += 1;
    validateProfile(record.profile);
    assert(record.profile.profile.id === record.id, `workspaces[${index}].id must match profile.profile.id`);
  }

  assert(nonEmptyString(library.active_workspace_id), 'active_workspace_id is required');
  const active = library.workspaces.find(record => record.id === library.active_workspace_id);
  assert(active, 'active_workspace_id must identify an existing workspace');
  assert(!active.archived, 'The active workspace cannot be archived');
  assert(availableWorkspaceCount > 0, 'Workspace library must contain at least one available workspace');
  return library;
}

export function activeWorkspaceRecord(library) {
  validateWorkspaceLibrary(library);
  return library.workspaces.find(record => record.id === library.active_workspace_id);
}

export function activeWorkspaceProfile(library) {
  return activeWorkspaceRecord(library).profile;
}

export function workspaceProfile(library, workspaceId) {
  const validated = validateWorkspaceLibrary(library);
  return clone(validated.workspaces[workspaceIndex(validated, workspaceId)].profile);
}

export function replaceActiveWorkspace(library, profile) {
  const next = clone(validateWorkspaceLibrary(library));
  const normalised = normaliseProfile(profile);
  const activeIndex = next.workspaces.findIndex(record => record.id === next.active_workspace_id);
  const duplicate = next.workspaces.findIndex((record, index) => index !== activeIndex && record.id === normalised.profile.id);
  assert(duplicate === -1, `Duplicate workspace id: ${normalised.profile.id}`);
  const archived = next.workspaces[activeIndex].archived;
  next.workspaces[activeIndex] = createWorkspaceRecord(normalised, {archived});
  next.active_workspace_id = normalised.profile.id;
  return validateWorkspaceLibrary(next);
}

export function setActiveWorkspace(library, workspaceId) {
  const next = clone(validateWorkspaceLibrary(library));
  const record = next.workspaces[workspaceIndex(next, workspaceId)];
  assert(!record.archived, 'An archived workspace cannot be activated');
  next.active_workspace_id = workspaceId;
  return validateWorkspaceLibrary(next);
}

export function addWorkspace(library, profile, {activate = false, archived = false} = {}) {
  const next = clone(validateWorkspaceLibrary(library));
  const record = createWorkspaceRecord(profile, {archived});
  assert(!next.workspaces.some(workspace => workspace.id === record.id), `Duplicate workspace id: ${record.id}`);
  assert(next.workspaces.length < MAX_WORKSPACES, `Workspace library contains too many workspaces (maximum ${MAX_WORKSPACES})`);
  next.workspaces.push(record);
  if (activate) {
    assert(!record.archived, 'An archived workspace cannot be activated');
    next.active_workspace_id = record.id;
  }
  return validateWorkspaceLibrary(next);
}

export function renameWorkspace(library, workspaceId, name) {
  const next = clone(validateWorkspaceLibrary(library));
  const trimmedName = String(name ?? '').trim();
  assert(nonEmptyString(trimmedName), 'Workspace name is required');
  const index = workspaceIndex(next, workspaceId);
  next.workspaces[index].profile.profile.name = trimmedName;
  next.workspaces[index].profile.profile.source = 'local';
  return validateWorkspaceLibrary(next);
}

export function duplicateWorkspace(library, workspaceId, {id, name, activate = true} = {}) {
  const next = clone(validateWorkspaceLibrary(library));
  assert(nonEmptyString(id), 'New workspace id is required');
  assert(!next.workspaces.some(record => record.id === id), `Duplicate workspace id: ${id}`);
  assert(next.workspaces.length < MAX_WORKSPACES, `Workspace library contains too many workspaces (maximum ${MAX_WORKSPACES})`);
  const sourceIndex = workspaceIndex(next, workspaceId);
  const duplicatedProfile = clone(next.workspaces[sourceIndex].profile);
  duplicatedProfile.profile.id = id;
  duplicatedProfile.profile.name = String(name ?? '').trim() || `Copy of ${duplicatedProfile.profile.name}`;
  duplicatedProfile.profile.source = 'local';
  const record = createWorkspaceRecord(duplicatedProfile);
  next.workspaces.splice(sourceIndex + 1, 0, record);
  if (activate)
    next.active_workspace_id = record.id;
  return validateWorkspaceLibrary(next);
}

export function setWorkspaceArchived(library, workspaceId, archived) {
  const next = clone(validateWorkspaceLibrary(library));
  const index = workspaceIndex(next, workspaceId);
  if (archived)
    assert(workspaceId !== next.active_workspace_id, 'The active workspace cannot be archived');
  next.workspaces[index].archived = Boolean(archived);
  return validateWorkspaceLibrary(next);
}

export function removeWorkspace(library, workspaceId) {
  const next = clone(validateWorkspaceLibrary(library));
  assert(workspaceId !== next.active_workspace_id, 'The active workspace cannot be removed');
  const index = workspaceIndex(next, workspaceId);
  assert(next.workspaces[index].archived, 'A workspace must be archived before it can be removed');
  next.workspaces.splice(index, 1);
  return validateWorkspaceLibrary(next);
}

export function moveWorkspace(library, workspaceId, direction) {
  const next = clone(validateWorkspaceLibrary(library));
  assert(direction === 'up' || direction === 'down', 'Workspace move direction is unsupported');
  const index = workspaceIndex(next, workspaceId);
  const archived = next.workspaces[index].archived;
  const step = direction === 'up' ? -1 : 1;
  let target = index + step;
  while (target >= 0 && target < next.workspaces.length && next.workspaces[target].archived !== archived)
    target += step;
  if (target < 0 || target >= next.workspaces.length)
    return validateWorkspaceLibrary(next);
  [next.workspaces[index], next.workspaces[target]] = [next.workspaces[target], next.workspaces[index]];
  return validateWorkspaceLibrary(next);
}

export function updateApplicationSettings(library, patch) {
  const next = clone(validateWorkspaceLibrary(library));
  next.application_settings = {
    ...next.application_settings,
    ...clone(patch),
  };
  return validateWorkspaceLibrary(next);
}

export function workspaceLibrarySummary(library) {
  validateWorkspaceLibrary(library);
  return {
    activeWorkspaceId: library.active_workspace_id,
    language: library.application_settings.language,
    total: library.workspaces.length,
    active: library.workspaces.filter(record => !record.archived).length,
    archived: library.workspaces.filter(record => record.archived).length,
    workspaces: library.workspaces.map((record, position) => ({
      id: record.id,
      archived: record.archived,
      position,
      ...profileSummary(record.profile),
    })),
  };
}

export function serializeWorkspaceLibrary(library) {
  validateWorkspaceLibrary(library);
  return `${JSON.stringify(library, null, 2)}\n`;
}
