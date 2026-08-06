export const CURRENT_SCHEMA_VERSION = 12;

const SECTION_NAMES = Object.freeze([
  'apps',
  'web_apps',
  'files_places',
  'daily_tools',
  'help_support',
]);

const TABBED_SECTION_NAMES = Object.freeze([
  'apps',
  'web_apps',
  'files_places',
  'daily_tools',
]);
const DEFAULT_SECTION_TAB_ID = 'general';
const MAX_SECTION_TABS = 20;
const MAX_TAB_TITLE_LENGTH = 80;

const TILE_TYPES = new Set(['application', 'web', 'place', 'action']);
const PROFILE_SOURCES = new Set(['example', 'imported', 'local']);
const STATUS_SOURCES = new Set(['configured', 'detected', 'unchecked']);
const ICON_STYLES = new Set(['fluent-linux-color', 'fluent-linux-grey', 'fluent-ui-color', 'system']);
const ITEM_ORIGINS = new Set(['example', 'local', 'organisation']);
const APPLICATION_SOURCES = new Set(['system', 'flatpak-system', 'flatpak-user', 'snap', 'user', 'sandbox', 'unknown']);
const APPLICATION_ICON_POLICIES = new Set(['application', 'dashboard']);
const APPLICATION_ICON_OVERRIDES = new Set(['inherit', 'application', 'dashboard']);
const WEB_ICON_ROLES = new Set(['web', 'accounting', 'people', 'board', 'calendar', 'document', 'mail', 'support', 'guide', 'apps', 'folder', 'backup']);
export const MAX_PROFILE_TILES = 500;
const MAX_TILES = MAX_PROFILE_TILES;
const MAX_TITLE_LENGTH = 120;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_TARGET_LENGTH = 2048;

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

function migrateV1(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 2;
  migrated.profile.source = migrated.profile.id?.includes('example') ? 'example' : 'imported';
  migrated.status = (migrated.status ?? []).map(item => ({
    ...item,
    value: item.id === 'shared-files' ? 'Configured' : item.id === 'browser' ? 'Detected by system' : 'Not checked',
    state: item.id === 'shared-files' || item.id === 'browser' ? 'info' : 'unknown',
    source: item.id === 'shared-files' ? 'configured' : item.id === 'browser' ? 'detected' : 'unchecked',
  }));
  return migrated;
}

function migrateV2(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 3;
  migrated.settings = {
    ...migrated.settings,
    setup_completed: migrated.profile?.source !== 'example',
    icon_style: 'system',
    section_visibility: {
      apps: true,
      web_apps: true,
      files_places: true,
      workspace_status: true,
      help_support: true,
    },
  };
  return migrated;
}


function migrateV3(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 4;
  const source = migrated.profile?.source;
  const origin = source === 'example' ? 'example' : source === 'imported' ? 'organisation' : 'local';
  for (const items of Object.values(migrated.sections ?? {})) {
    for (const item of items) {
      item.origin = item.origin ?? origin;
      item.locked = item.locked ?? false;
    }
  }
  return migrated;
}


function migrateV4(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 5;
  migrated.settings.language = migrated.settings.language ?? 'system';
  return migrated;
}

function migrateV5(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 6;
  if (migrated.settings.icon_style === 'workspace-grey')
    migrated.settings.icon_style = 'fluent-grey';
  migrated.settings.icon_style = migrated.settings.icon_style ?? 'system';

  const exampleApplicationIcons = {
    email: 'thunderbird',
    documents: 'org.onlyoffice.desktopeditors',
    calendar: 'org.gnome.Calendar',
    passwords: 'me.proton.Pass',
    scanning: 'org.gnome.SimpleScan',
    meetings: 'Zoom',
    'remote-support': 'com.rustdesk.RustDesk',
  };
  for (const items of Object.values(migrated.sections ?? {})) {
    for (const item of items) {
      if (item.type === 'application' && item.origin === 'example' && exampleApplicationIcons[item.id])
        item.icon_name = exampleApplicationIcons[item.id];
    }
  }
  return migrated;
}

function migrateV6(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 7;
  const legacyStyles = {
    'workspace-grey': 'fluent-linux-grey',
    'fluent-grey': 'fluent-linux-grey',
    'fluent-color': 'fluent-ui-color',
  };
  migrated.settings.icon_style = legacyStyles[migrated.settings.icon_style]
    ?? migrated.settings.icon_style
    ?? 'fluent-linux-color';
  return migrated;
}

function migrateV7(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 8;
  for (const items of Object.values(migrated.sections ?? {})) {
    for (const item of items) {
      if (item.type === 'application')
        item.application_source = item.application_source ?? 'unknown';
    }
  }
  return migrated;
}


function migrateV8(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 9;
  migrated.settings.application_icon_policy = migrated.settings.application_icon_policy ?? 'application';
  for (const items of Object.values(migrated.sections ?? {})) {
    for (const item of items) {
      if (item.type === 'application')
        item.icon_override = item.icon_override ?? 'inherit';
    }
  }
  return migrated;
}

function inferLegacyWebIconRole(item) {
  const byId = {
    accounting: 'accounting',
    crm: 'people',
    projects: 'board',
    portal: 'web',
    guide: 'guide',
    contact: 'mail',
  };
  if (byId[item.id])
    return byId[item.id];
  const iconName = String(item.icon_name || '').toLowerCase();
  if (iconName.includes('user') || iconName.includes('contact') || iconName.includes('people'))
    return 'people';
  if (iconName.includes('grid') || iconName.includes('board'))
    return 'board';
  if (iconName.includes('calendar'))
    return 'calendar';
  if (iconName.includes('mail'))
    return 'mail';
  if (iconName.includes('help') || iconName.includes('guide'))
    return 'guide';
  if (iconName.includes('document') || iconName.includes('office'))
    return 'document';
  if (iconName.includes('folder'))
    return 'folder';
  return 'web';
}

function migrateV9(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 10;
  for (const items of Object.values(migrated.sections ?? {})) {
    for (const item of items) {
      if (item.type === 'web')
        item.icon_role = WEB_ICON_ROLES.has(item.icon_role) ? item.icon_role : inferLegacyWebIconRole(item);
    }
  }
  return migrated;
}

function migrateV10(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 11;
  delete migrated.settings?.language;
  return migrated;
}

function migrateV11(profile) {
  const migrated = clone(profile);
  migrated.schema_version = 12;
  migrated.settings.section_tabs = {};
  for (const sectionName of TABBED_SECTION_NAMES) {
    migrated.settings.section_tabs[sectionName] = {
      tabs: [{id: DEFAULT_SECTION_TAB_ID, title: 'General', position: 1, is_default: true}],
      active_tab_id: DEFAULT_SECTION_TAB_ID,
    };
    for (const item of migrated.sections?.[sectionName] ?? [])
      item.tab_id = DEFAULT_SECTION_TAB_ID;
  }
  return migrated;
}

export function normaliseProfile(profile) {
  assert(isObject(profile), 'Workspace profile must be an object');
  let migrated = clone(profile);
  if (migrated.schema_version === 1)
    migrated = migrateV1(migrated);
  if (migrated.schema_version === 2)
    migrated = migrateV2(migrated);
  if (migrated.schema_version === 3)
    migrated = migrateV3(migrated);
  if (migrated.schema_version === 4)
    migrated = migrateV4(migrated);
  if (migrated.schema_version === 5)
    migrated = migrateV5(migrated);
  if (migrated.schema_version === 6)
    migrated = migrateV6(migrated);
  if (migrated.schema_version === 7)
    migrated = migrateV7(migrated);
  if (migrated.schema_version === 8)
    migrated = migrateV8(migrated);
  if (migrated.schema_version === 9)
    migrated = migrateV9(migrated);
  if (migrated.schema_version === 10)
    migrated = migrateV10(migrated);
  if (migrated.schema_version === 11)
    migrated = migrateV11(migrated);
  return validateProfile(migrated);
}

function validateTile(tile, sectionName, index, seenIds, validTabIds = null) {
  const label = `${sectionName}[${index}]`;
  assert(isObject(tile), `${label} must be an object`);
  assert(nonEmptyString(tile.id), `${label}.id must be a non-empty string`);
  assert(!seenIds.has(tile.id), `Duplicate tile id: ${tile.id}`);
  seenIds.add(tile.id);
  assert(TILE_TYPES.has(tile.type), `${label}.type is unsupported`);
  assert(nonEmptyString(tile.title), `${label}.title must be a non-empty string`);
  assert(tile.title.length <= MAX_TITLE_LENGTH, `${label}.title is too long`);
  assert(tile.subtitle === undefined || typeof tile.subtitle === 'string', `${label}.subtitle must be a string`);
  assert((tile.subtitle ?? '').length <= MAX_SUBTITLE_LENGTH, `${label}.subtitle is too long`);
  assert(tile.icon_name === undefined || typeof tile.icon_name === 'string', `${label}.icon_name must be a string`);
  assert(tile.enabled === undefined || typeof tile.enabled === 'boolean', `${label}.enabled must be true or false`);
  assert(tile.position === undefined || Number.isInteger(tile.position), `${label}.position must be an integer`);
  assert(ITEM_ORIGINS.has(tile.origin), `${label}.origin is unsupported`);
  assert(typeof tile.locked === 'boolean', `${label}.locked must be true or false`);
  if (validTabIds) {
    assert(nonEmptyString(tile.tab_id), `${label}.tab_id is required`);
    assert(validTabIds.has(tile.tab_id), `${label}.tab_id must identify a tab in ${sectionName}`);
  } else {
    assert(tile.tab_id === undefined, `${label}.tab_id is not supported in ${sectionName}`);
  }

  if (tile.type === 'application') {
    assert(nonEmptyString(tile.desktop_id), `${label}.desktop_id is required for applications`);
    assert(tile.desktop_id.length <= MAX_TARGET_LENGTH, `${label}.desktop_id is too long`);
    assert(tile.desktop_id.endsWith('.desktop'), `${label}.desktop_id must identify a desktop application`);
    assert(APPLICATION_SOURCES.has(tile.application_source), `${label}.application_source is unsupported`);
    assert(APPLICATION_ICON_OVERRIDES.has(tile.icon_override), `${label}.icon_override is unsupported`);
  }
  if (tile.type === 'web') {
    assert(WEB_ICON_ROLES.has(tile.icon_role), `${label}.icon_role is unsupported`);
    assert(nonEmptyString(tile.url), `${label}.url is required for websites`);
    assert(tile.url.length <= MAX_TARGET_LENGTH, `${label}.url is too long`);
    assert(/^(https?:|mailto:)/i.test(tile.url), `${label}.url must use HTTP, HTTPS or mailto`);
  }
  if (tile.type === 'place') {
    assert(nonEmptyString(tile.uri), `${label}.uri is required for files and places`);
    assert(tile.uri.length <= MAX_TARGET_LENGTH, `${label}.uri is too long`);
    assert(/^(~\/|\/|file:|smb:|dav:|davs:)/i.test(tile.uri), `${label}.uri must be a local path or supported location URI`);
  }
  if (tile.type === 'action') {
    assert(nonEmptyString(tile.action), `${label}.action is required for actions`);
    assert(tile.action.length <= MAX_TARGET_LENGTH, `${label}.action is too long`);
  }
}

export function validateProfile(profile) {
  assert(isObject(profile), 'Workspace profile must be an object');
  assert(profile.format === 'workspace-hub-profile', 'Unsupported workspace profile format');
  assert(profile.schema_version === CURRENT_SCHEMA_VERSION, 'Unsupported workspace profile schema version');
  assert(isObject(profile.profile), 'profile must be an object');
  assert(nonEmptyString(profile.profile.id), 'profile.id is required');
  assert(profile.profile.id.length <= MAX_TITLE_LENGTH, 'profile.id is too long');
  assert(nonEmptyString(profile.profile.name), 'profile.name is required');
  assert(profile.profile.name.length <= MAX_TITLE_LENGTH, 'profile.name is too long');
  assert(PROFILE_SOURCES.has(profile.profile.source), 'profile.source is unsupported');
  for (const field of ['organisation', 'revision', 'managed_by']) {
    assert(profile.profile[field] === undefined || typeof profile.profile[field] === 'string', `profile.${field} must be a string`);
    assert((profile.profile[field] ?? '').length <= MAX_SUBTITLE_LENGTH, `profile.${field} is too long`);
  }

  assert(isObject(profile.settings), 'settings must be an object');
  assert(profile.settings.greeting_name === undefined || typeof profile.settings.greeting_name === 'string', 'settings.greeting_name must be a string');
  assert((profile.settings.greeting_name ?? '').length <= MAX_TITLE_LENGTH, 'settings.greeting_name is too long');
  assert(profile.settings.show_attention_banner === undefined || typeof profile.settings.show_attention_banner === 'boolean', 'settings.show_attention_banner must be true or false');
  assert(typeof profile.settings.setup_completed === 'boolean', 'settings.setup_completed must be true or false');
  assert(ICON_STYLES.has(profile.settings.icon_style), 'settings.icon_style is unsupported');
  assert(APPLICATION_ICON_POLICIES.has(profile.settings.application_icon_policy), 'settings.application_icon_policy is unsupported');
  assert(isObject(profile.settings.section_visibility), 'settings.section_visibility must be an object');
  for (const key of ['apps', 'web_apps', 'files_places', 'workspace_status', 'help_support'])
    assert(typeof profile.settings.section_visibility[key] === 'boolean', `settings.section_visibility.${key} must be true or false`);

  assert(isObject(profile.settings.section_tabs), 'settings.section_tabs must be an object');
  const tabIdsBySection = new Map();
  for (const sectionName of TABBED_SECTION_NAMES) {
    const state = profile.settings.section_tabs[sectionName];
    assert(isObject(state), `settings.section_tabs.${sectionName} must be an object`);
    assert(Array.isArray(state.tabs), `settings.section_tabs.${sectionName}.tabs must be an array`);
    assert(state.tabs.length > 0, `settings.section_tabs.${sectionName} must contain at least one tab`);
    assert(state.tabs.length <= MAX_SECTION_TABS, `settings.section_tabs.${sectionName} contains too many tabs`);
    const tabIds = new Set();
    const tabTitles = new Set();
    const tabPositions = new Set();
    let defaultCount = 0;
    for (const [index, tab] of state.tabs.entries()) {
      const label = `settings.section_tabs.${sectionName}.tabs[${index}]`;
      assert(isObject(tab), `${label} must be an object`);
      assert(nonEmptyString(tab.id), `${label}.id is required`);
      assert(tab.id.length <= MAX_TITLE_LENGTH, `${label}.id is too long`);
      assert(!tabIds.has(tab.id), `Duplicate tab id in ${sectionName}: ${tab.id}`);
      tabIds.add(tab.id);
      assert(nonEmptyString(tab.title), `${label}.title is required`);
      assert(tab.title.length <= MAX_TAB_TITLE_LENGTH, `${label}.title is too long`);
      const comparableTitle = tab.title.trim().toLowerCase();
      assert(!tabTitles.has(comparableTitle), `Duplicate tab title in ${sectionName}: ${tab.title}`);
      tabTitles.add(comparableTitle);
      assert(Number.isInteger(tab.position) && tab.position >= 1, `${label}.position must be a positive integer`);
      assert(!tabPositions.has(tab.position), `Duplicate tab position in ${sectionName}: ${tab.position}`);
      tabPositions.add(tab.position);
      assert(typeof tab.is_default === 'boolean', `${label}.is_default must be true or false`);
      if (tab.is_default)
        defaultCount += 1;
    }
    assert(defaultCount === 1, `settings.section_tabs.${sectionName} must contain exactly one default tab`);
    const defaultTab = state.tabs.find(tab => tab.id === DEFAULT_SECTION_TAB_ID);
    assert(defaultTab?.is_default === true, `settings.section_tabs.${sectionName} must use ${DEFAULT_SECTION_TAB_ID} as its default tab`);
    const orderedPositions = [...tabPositions].sort((a, b) => a - b);
    assert(orderedPositions.every((position, index) => position === index + 1), `settings.section_tabs.${sectionName} positions must be contiguous`);
    assert(nonEmptyString(state.active_tab_id), `settings.section_tabs.${sectionName}.active_tab_id is required`);
    assert(tabIds.has(state.active_tab_id), `settings.section_tabs.${sectionName}.active_tab_id must identify an existing tab`);
    tabIdsBySection.set(sectionName, tabIds);
  }

  assert(isObject(profile.sections), 'sections must be an object');
  const seenIds = new Set();
  for (const sectionName of SECTION_NAMES) {
    const items = profile.sections[sectionName];
    assert(Array.isArray(items), `sections.${sectionName} must be an array`);
    const validTabIds = tabIdsBySection.get(sectionName) ?? null;
    items.forEach((tile, index) => validateTile(tile, sectionName, index, seenIds, validTabIds));
  }

  const totalTiles = SECTION_NAMES.reduce((sum, sectionName) => sum + profile.sections[sectionName].length, 0);
  assert(totalTiles <= MAX_TILES, `Workspace profile contains too many items (maximum ${MAX_TILES})`);

  assert(Array.isArray(profile.status), 'status must be an array');
  for (const [index, item] of profile.status.entries()) {
    assert(isObject(item), `status[${index}] must be an object`);
    assert(nonEmptyString(item.id), `status[${index}].id is required`);
    assert(nonEmptyString(item.title), `status[${index}].title is required`);
    assert(typeof item.value === 'string', `status[${index}].value must be a string`);
    assert(STATUS_SOURCES.has(item.source), `status[${index}].source is unsupported`);
  }

  return profile;
}


export function markProfileLocallyModified(profile) {
  validateProfile(profile);
  profile.profile.source = 'local';
  return profile;
}

export function profileSummary(profile) {
  validateProfile(profile);
  return {
    name: profile.profile.name,
    organisation: profile.profile.organisation ?? '',
    revision: profile.profile.revision ?? '',
    source: profile.profile.source,
    apps: profile.sections.apps.filter(item => item.enabled !== false).length,
    webApps: profile.sections.web_apps.filter(item => item.enabled !== false).length,
    places: profile.sections.files_places.filter(item => item.enabled !== false).length,
    dailyTools: profile.sections.daily_tools.filter(item => item.enabled !== false).length,
    supportActions: profile.sections.help_support.filter(item => item.enabled !== false).length,
  };
}

export function serializeProfile(profile) {
  validateProfile(profile);
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export const PROFILE_SECTION_NAMES = SECTION_NAMES;
export const PROFILE_TABBED_SECTION_NAMES = TABBED_SECTION_NAMES;
