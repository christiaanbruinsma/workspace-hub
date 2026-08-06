function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function comparableItem(item) {
  const copy = clone(item);
  delete copy.position;
  return copy;
}

export function diffProfiles(current, candidate) {
  const added = [];
  const changed = [];
  const removed = [];
  const sections = new Set([...Object.keys(current.sections ?? {}), ...Object.keys(candidate.sections ?? {})]);

  for (const section of sections) {
    const before = new Map((current.sections?.[section] ?? []).map(item => [item.id, item]));
    const after = new Map((candidate.sections?.[section] ?? []).map(item => [item.id, item]));
    for (const [id, item] of after) {
      if (!before.has(id))
        added.push({section, id, title:item.title});
      else if (JSON.stringify(comparableItem(before.get(id))) !== JSON.stringify(comparableItem(item)))
        changed.push({section, id, title:item.title});
    }
    for (const [id, item] of before) {
      if (!after.has(id))
        removed.push({section, id, title:item.title});
    }
  }

  const identityChanged = JSON.stringify(current.profile ?? {}) !== JSON.stringify(candidate.profile ?? {}) ||
    JSON.stringify(current.settings ?? {}) !== JSON.stringify(candidate.settings ?? {});
  return {
    added,
    changed,
    removed,
    identityChanged,
    total: added.length + changed.length + removed.length + (identityChanged ? 1 : 0),
  };
}

export function createHistoryRecord({action, summary, profile, timestamp, restoreFile = null, details = {}}) {
  return {
    id: `${timestamp}-${action}-${restoreFile ?? 'none'}`,
    timestamp,
    action,
    summary,
    profile: {
      id: profile.profile.id,
      name: profile.profile.name,
      revision: profile.profile.revision ?? '',
      source: profile.profile.source,
    },
    restore_file: restoreFile,
    details: clone(details),
  };
}


export function historyForWorkspace(records, workspaceId, {includeLegacy = false} = {}) {
  if (!Array.isArray(records) || typeof workspaceId !== 'string' || workspaceId.length === 0)
    return [];
  return records.filter(record => {
    const recordWorkspaceId = record?.details?.workspace_id;
    if (typeof recordWorkspaceId === 'string')
      return recordWorkspaceId === workspaceId;
    return Boolean(includeLegacy);
  });
}

export function governanceLabel(item) {
  if (item.locked)
    return 'Managed by organisation';
  if (item.origin === 'organisation')
    return 'Organisation item';
  if (item.origin === 'example')
    return 'Example item';
  return 'Local item';
}
