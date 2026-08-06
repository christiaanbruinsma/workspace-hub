function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sortWorkspaceItems(items) {
  return [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function createUniqueTileId(title, sections) {
  const base = String(title || 'item')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
  const used = new Set(Object.values(sections).flat().map(item => item.id));
  if (!used.has(base))
    return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`))
    suffix += 1;
  return `${base}-${suffix}`;
}


export function workspaceItemIds(sections) {
  return new Set(Object.values(sections ?? {}).flat().map(item => item.id));
}

export function createCollisionSafeTileId(preferredId, sections, {
  generator = null,
  maximumAttempts = 100,
} = {}) {
  const used = workspaceItemIds(sections);
  const canonicalBase = String(preferredId || 'item')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const candidate = generator
      ? String(generator({baseId: canonicalBase, attempt}) ?? '')
      : attempt === 1 ? `${canonicalBase}-copy` : `${canonicalBase}-copy-${attempt}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate))
      continue;
    if (!used.has(candidate))
      return candidate;
  }
  throw new Error('Unable to generate a safe unique workspace item id');
}

function assertEditable(item) {
  if (item?.locked)
    throw new Error('This item is managed by the organisation and cannot be changed locally');
}

function sameTab(left, right) {
  return (left?.tab_id ?? null) === (right?.tab_id ?? null);
}

function normalisePositions(items) {
  const groups = new Map();
  items.forEach((item, storageIndex) => {
    const key = item.tab_id ?? null;
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push({item, storageIndex});
  });
  for (const group of groups.values()) {
    group
      .sort((left, right) => (left.item.position ?? 0) - (right.item.position ?? 0) || left.storageIndex - right.storageIndex)
      .forEach(({item}, index) => {
        item.position = index + 1;
      });
  }
}

export function upsertWorkspaceItem(profile, sectionName, item) {
  const next = clone(profile);
  const items = next.sections[sectionName];
  if (!Array.isArray(items))
    throw new Error(`Unknown workspace section: ${sectionName}`);
  const index = items.findIndex(entry => entry.id === item.id);
  if (index >= 0) {
    assertEditable(items[index]);
    items[index] = {...clone(item), origin:item.origin ?? items[index].origin ?? 'local', locked:item.locked ?? false};
  } else {
    const position = items.filter(entry => sameTab(entry, item)).length + 1;
    items.push({...clone(item), origin:item.origin ?? 'local', locked:item.locked ?? false, position});
  }
  normalisePositions(items);
  next.profile.source = 'local';
  return next;
}

export function removeWorkspaceItem(profile, sectionName, itemId) {
  const next = clone(profile);
  const items = next.sections[sectionName];
  if (!Array.isArray(items))
    throw new Error(`Unknown workspace section: ${sectionName}`);
  const existing = items.find(item => item.id === itemId);
  assertEditable(existing);
  next.sections[sectionName] = items.filter(item => item.id !== itemId);
  normalisePositions(next.sections[sectionName]);
  next.profile.source = 'local';
  return next;
}

export function moveWorkspaceItemToTab(profile, sectionName, itemId, destinationTabId) {
  const next = clone(profile);
  const items = next.sections[sectionName];
  if (!Array.isArray(items))
    throw new Error(`Unknown workspace section: ${sectionName}`);

  const tabState = next.settings?.section_tabs?.[sectionName];
  if (!tabState || !Array.isArray(tabState.tabs))
    throw new Error(`Section does not support tabs: ${sectionName}`);

  const item = items.find(entry => entry.id === itemId);
  if (!item)
    throw new Error(`Workspace item not found: ${itemId}`);
  assertEditable(item);

  if (!tabState.tabs.some(tab => tab.id === destinationTabId))
    throw new Error(`Unknown tab id for ${sectionName}: ${destinationTabId}`);
  if (item.tab_id === destinationTabId)
    throw new Error('The item is already in the selected tab');

  const destinationPositions = items
    .filter(entry => entry.id !== itemId && entry.tab_id === destinationTabId)
    .map(entry => Number.isFinite(entry.position) ? entry.position : 0);
  item.tab_id = destinationTabId;
  item.position = Math.max(0, ...destinationPositions) + 1;
  normalisePositions(items);
  next.profile.source = 'local';
  return next;
}

export function moveWorkspaceItem(profile, sectionName, itemId, direction) {
  const next = clone(profile);
  const allItems = next.sections[sectionName] ?? [];
  const item = allItems.find(entry => entry.id === itemId);
  if (!item)
    throw new Error(`Workspace item not found: ${itemId}`);
  assertEditable(item);

  const items = sortWorkspaceItems(allItems.filter(entry => sameTab(entry, item)));
  const index = items.findIndex(entry => entry.id === itemId);
  const target = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index;
  if (target < 0 || target >= items.length)
    return next;

  [items[index], items[target]] = [items[target], items[index]];
  items.forEach((entry, position) => {
    const stored = allItems.find(candidate => candidate.id === entry.id);
    stored.position = position + 1;
  });
  next.profile.source = 'local';
  return next;
}

export function setWorkspaceItemGovernance(profile, sectionName, itemId, {origin, locked}) {
  const next = clone(profile);
  const items = next.sections[sectionName];
  if (!Array.isArray(items))
    throw new Error(`Unknown workspace section: ${sectionName}`);
  const item = items.find(entry => entry.id === itemId);
  if (!item)
    throw new Error(`Workspace item not found: ${itemId}`);
  item.origin = origin;
  item.locked = locked;
  next.profile.source = 'local';
  return next;
}

export function normaliseWorkspaceSectionPositions(profile, sectionName) {
  const next = clone(profile);
  const items = next.sections[sectionName];
  if (!Array.isArray(items))
    throw new Error(`Unknown workspace section: ${sectionName}`);
  normalisePositions(items);
  return next;
}
