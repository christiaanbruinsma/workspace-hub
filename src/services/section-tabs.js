export const TABBED_SECTION_NAMES = Object.freeze([
  'apps',
  'web_apps',
  'files_places',
  'daily_tools',
]);

export const DEFAULT_SECTION_TAB_ID = 'general';
export const MAX_SECTION_TABS = 20;
export const MAX_SECTION_TAB_TITLE_LENGTH = 80;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertTabbedSection(sectionName) {
  if (!TABBED_SECTION_NAMES.includes(sectionName))
    throw new Error(`Section does not support tabs: ${sectionName}`);
}

function slug(value) {
  return String(value || 'tab')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'tab';
}

export function sortSectionTabs(tabs) {
  return [...tabs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function sectionTabState(profile, sectionName) {
  assertTabbedSection(sectionName);
  const state = profile.settings?.section_tabs?.[sectionName];
  if (!state || !Array.isArray(state.tabs))
    throw new Error(`Missing section tab state: ${sectionName}`);
  return state;
}

export function sectionTabs(profile, sectionName) {
  return sortSectionTabs(sectionTabState(profile, sectionName).tabs);
}

export function activeSectionTabId(profile, sectionName) {
  return sectionTabState(profile, sectionName).active_tab_id;
}

export function sectionItemsForTab(profile, sectionName, tabId = activeSectionTabId(profile, sectionName)) {
  assertTabbedSection(sectionName);
  return (profile.sections?.[sectionName] ?? []).filter(item => item.tab_id === tabId);
}

export function createUniqueSectionTabId(title, tabs) {
  const base = slug(title);
  const used = new Set(tabs.map(tab => tab.id));
  if (!used.has(base))
    return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`))
    suffix += 1;
  return `${base}-${suffix}`;
}

export function addSectionTab(profile, sectionName, title, {activate = true} = {}) {
  assertTabbedSection(sectionName);
  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle)
    throw new Error('A tab name is required');
  if (trimmedTitle.length > MAX_SECTION_TAB_TITLE_LENGTH)
    throw new Error(`A tab name can contain at most ${MAX_SECTION_TAB_TITLE_LENGTH} characters`);

  const next = clone(profile);
  const state = sectionTabState(next, sectionName);
  const comparableTitle = trimmedTitle.toLowerCase();
  if (state.tabs.some(tab => String(tab.title).trim().toLowerCase() === comparableTitle))
    throw new Error('A tab with this name already exists');
  if (state.tabs.length >= MAX_SECTION_TABS)
    throw new Error(`A section can contain at most ${MAX_SECTION_TABS} tabs`);

  const id = createUniqueSectionTabId(trimmedTitle, state.tabs);
  state.tabs.push({
    id,
    title: trimmedTitle,
    position: state.tabs.length + 1,
    is_default: false,
  });
  if (activate)
    state.active_tab_id = id;
  next.profile.source = 'local';
  return next;
}

export function setActiveSectionTab(profile, sectionName, tabId) {
  assertTabbedSection(sectionName);
  const next = clone(profile);
  const state = sectionTabState(next, sectionName);
  if (!state.tabs.some(tab => tab.id === tabId))
    throw new Error(`Unknown tab id for ${sectionName}: ${tabId}`);
  state.active_tab_id = tabId;
  return next;
}



export function renameSectionTab(profile, sectionName, tabId, title) {
  assertTabbedSection(sectionName);
  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle)
    throw new Error('A tab name is required');
  if (trimmedTitle.length > MAX_SECTION_TAB_TITLE_LENGTH)
    throw new Error(`A tab name can contain at most ${MAX_SECTION_TAB_TITLE_LENGTH} characters`);

  const next = clone(profile);
  const state = sectionTabState(next, sectionName);
  const tab = state.tabs.find(entry => entry.id === tabId);
  if (!tab)
    throw new Error(`Unknown tab id for ${sectionName}: ${tabId}`);
  const comparableTitle = trimmedTitle.toLowerCase();
  if (state.tabs.some(entry => entry.id !== tabId && String(entry.title).trim().toLowerCase() === comparableTitle))
    throw new Error('A tab with this name already exists');
  tab.title = trimmedTitle;
  next.profile.source = 'local';
  return next;
}

export function moveSectionTab(profile, sectionName, tabId, direction) {
  assertTabbedSection(sectionName);
  const tabs = sectionTabs(profile, sectionName);
  const index = tabs.findIndex(tab => tab.id === tabId);
  if (index < 0)
    throw new Error(`Unknown tab id for ${sectionName}: ${tabId}`);
  const targetIndex = direction === 'earlier' ? index - 1 : direction === 'later' ? index + 1 : -1;
  if (targetIndex < 0 || targetIndex >= tabs.length)
    throw new Error('The tab cannot be moved further in that direction');
  const orderedIds = tabs.map(tab => tab.id);
  [orderedIds[index], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[index]];
  return reorderSectionTabs(profile, sectionName, orderedIds);
}

export function reorderSectionTabs(profile, sectionName, orderedIds) {
  assertTabbedSection(sectionName);
  const next = clone(profile);
  const state = sectionTabState(next, sectionName);
  const currentIds = new Set(state.tabs.map(tab => tab.id));
  if (!Array.isArray(orderedIds) || orderedIds.length !== currentIds.size)
    throw new Error('The tab order is incomplete');
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !currentIds.has(id)))
    throw new Error('The tab order contains unknown or duplicate tabs');
  const positions = new Map(orderedIds.map((id, index) => [id, index + 1]));
  state.tabs.forEach(tab => {
    tab.position = positions.get(tab.id);
  });
  next.profile.source = 'local';
  return next;
}

export function removeSectionTab(profile, sectionName, tabId, {moveItemsToTabId = null} = {}) {
  assertTabbedSection(sectionName);
  const next = clone(profile);
  const state = sectionTabState(next, sectionName);
  if (state.tabs.length <= 1)
    throw new Error('The last remaining tab cannot be removed');
  const tab = state.tabs.find(entry => entry.id === tabId);
  if (!tab)
    throw new Error(`Unknown tab id for ${sectionName}: ${tabId}`);
  if (tab.is_default)
    throw new Error('The default tab cannot be removed');

  const sectionItems = next.sections?.[sectionName] ?? [];
  const items = sectionItems
    .filter(item => item.tab_id === tabId)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  if (items.length > 0) {
    if (items.some(item => item.locked))
      throw new Error('A tab that contains managed items cannot be deleted');
    const target = state.tabs.find(entry => entry.id === moveItemsToTabId && entry.id !== tabId);
    if (!target)
      throw new Error('Choose another tab before deleting a tab that contains items');
    const targetItems = sectionItems
      .filter(item => item.tab_id === target.id)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
    targetItems.forEach((item, index) => {
      item.position = index + 1;
    });
    items.forEach((item, index) => {
      item.tab_id = target.id;
      item.position = targetItems.length + index + 1;
    });
  }

  state.tabs = sortSectionTabs(state.tabs.filter(entry => entry.id !== tabId));
  state.tabs.forEach((entry, index) => {
    entry.position = index + 1;
  });
  if (state.active_tab_id === tabId)
    state.active_tab_id = moveItemsToTabId || state.tabs[0].id;
  next.profile.source = 'local';
  return next;
}

export function sectionTabDisplayTitle(tab, translate = key => key) {
  if (tab?.is_default && tab.id === DEFAULT_SECTION_TAB_ID && String(tab.title).trim().toLowerCase() === 'general')
    return translate('general_tab');
  return String(tab?.title ?? '');
}
