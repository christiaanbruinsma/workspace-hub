import {
  validateWorkspaceLibrary,
  workspaceProfile,
} from './workspace-library-contract.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function workspaceRecord(library, workspaceId) {
  const record = library.workspaces.find(candidate => candidate.id === workspaceId);
  assert(record, `Unknown workspace: ${workspaceId}`);
  return record;
}

/**
 * Replace only the configurable contents of one available workspace.
 *
 * The target workspace remains the same workspace: its profile identity,
 * organisation metadata and archive state are retained. Settings, tabs,
 * sections and status are copied as one validated profile snapshot so all
 * internal item/tab references remain consistent.
 */
export function replaceWorkspaceContents(library, sourceWorkspaceId, targetWorkspaceId) {
  const next = clone(validateWorkspaceLibrary(library));
  assert(sourceWorkspaceId !== targetWorkspaceId, 'Choose a different workspace as the target');

  const source = workspaceRecord(next, sourceWorkspaceId);
  const target = workspaceRecord(next, targetWorkspaceId);
  assert(!source.archived, 'An archived source workspace cannot be copied');
  assert(!target.archived, 'An archived target workspace cannot be overwritten');

  const targetIdentity = clone(target.profile.profile);
  const sourceContents = clone(source.profile);
  sourceContents.profile = targetIdentity;
  target.profile = sourceContents;

  return validateWorkspaceLibrary(next);
}

export function buildWorkspaceContentsCopyPlan(library, {
  sourceWorkspaceId,
  targetWorkspaceId,
} = {}) {
  const current = validateWorkspaceLibrary(library);
  const sourceProfile = workspaceProfile(current, sourceWorkspaceId);
  const targetProfile = workspaceProfile(current, targetWorkspaceId);
  const candidateLibrary = replaceWorkspaceContents(
    current,
    sourceWorkspaceId,
    targetWorkspaceId
  );
  const copiedTarget = workspaceProfile(candidateLibrary, targetWorkspaceId);

  return {
    candidateLibrary,
    restorePoints: [{workspaceId: targetWorkspaceId, profile: targetProfile}],
    historyRecords: [{
      workspaceId: targetWorkspaceId,
      profile: copiedTarget,
      event: {
        action: 'workspace-contents-replaced',
        summary: `Copied contents from ${sourceProfile.profile.name}`,
        details: {source_workspace_id: sourceWorkspaceId},
      },
    }],
    metadata: {
      sourceWorkspaceId,
      targetWorkspaceId,
      sourceWorkspaceName: sourceProfile.profile.name,
      targetWorkspaceName: targetProfile.profile.name,
    },
  };
}

export function workspaceContentsCopyDestinations(library, sourceWorkspaceId) {
  const current = validateWorkspaceLibrary(library);
  const source = workspaceRecord(current, sourceWorkspaceId);
  if (source.archived)
    return [];

  const available = current.workspaces.filter(record =>
    !record.archived && record.id !== sourceWorkspaceId
  );
  const nameCounts = new Map();
  for (const record of available) {
    const key = record.profile.profile.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return available.map(record => {
    const name = record.profile.profile.name;
    const duplicateName = (nameCounts.get(name.trim().toLowerCase()) ?? 0) > 1;
    return {
      id: record.id,
      name,
      displayName: duplicateName ? `${name} · ${record.id}` : name,
    };
  });
}
