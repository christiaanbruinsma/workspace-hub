export const ICON_STYLES = Object.freeze([
  'fluent-linux-color',
  'fluent-linux-grey',
  'fluent-ui-color',
  'system',
]);

export const WEB_ICON_ROLES = Object.freeze([
  'web',
  'accounting',
  'people',
  'board',
  'calendar',
  'document',
  'mail',
  'support',
  'guide',
  'apps',
  'folder',
  'backup',
]);

const WEB_ICON_ROLE_LABELS = Object.freeze({
  web: 'Website',
  accounting: 'Accounting',
  people: 'CRM & people',
  board: 'Project board',
  calendar: 'Calendar',
  document: 'Documents',
  mail: 'Communication',
  support: 'Support',
  guide: 'Guide',
  apps: 'Application portal',
  folder: 'Files',
  backup: 'Storage & backup',
});

const SYSTEM_ROLE_ICONS = Object.freeze({
  web: 'web-browser-symbolic',
  accounting: 'x-office-spreadsheet-symbolic',
  people: 'system-users-symbolic',
  board: 'view-grid-symbolic',
  calendar: 'x-office-calendar-symbolic',
  document: 'x-office-document-symbolic',
  mail: 'mail-send-symbolic',
  support: 'help-browser-symbolic',
  guide: 'help-contents-symbolic',
  apps: 'view-app-grid-symbolic',
  folder: 'folder-symbolic',
  backup: 'drive-harddisk-symbolic',
});

export function normaliseWebIconRole(value) {
  return WEB_ICON_ROLES.includes(value) ? value : 'web';
}

export function webIconRoleLabel(value) {
  return WEB_ICON_ROLE_LABELS[normaliseWebIconRole(value)];
}

const FLUENT_BY_ID = Object.freeze({
  email: 'mail',
  documents: 'document',
  calendar: 'calendar',
  passwords: 'credentials',
  scanning: 'scan',
  meetings: 'video',
  accounting: 'accounting',
  crm: 'people',
  projects: 'board',
  portal: 'web',
  'documents-folder': 'folder',
  'company-files': 'folder',
  'incoming-scans': 'scan',
  invoices: 'accounting',
  backups: 'backup',
  guide: 'guide',
  'remote-support': 'support',
  'support-report': 'report',
  contact: 'mail',
});

const FLUENT_BY_TYPE = Object.freeze({
  web: 'web',
  place: 'folder',
  action: 'support',
});

const SUMMARY_TOKENS = Object.freeze({
  apps: 'apps',
  web_apps: 'web',
  files_places: 'folder',
  support: 'support',
});

const STATUS_TOKENS = Object.freeze({
  backup: 'backup',
  updates: 'apps',
  'shared-files': 'folder',
  browser: 'web',
});

const SYSTEM_SUMMARY_ICONS = Object.freeze({
  apps: 'view-app-grid-symbolic',
  web_apps: 'web-browser-symbolic',
  files_places: 'folder-remote-symbolic',
  support: 'help-browser-symbolic',
});

const SYSTEM_FALLBACK = Object.freeze({
  application: 'application-x-executable-symbolic',
  web: 'web-browser-symbolic',
  place: 'folder-symbolic',
  action: 'system-run-symbolic',
});

export function normaliseIconStyle(value) {
  const legacy = {
    'workspace-grey': 'fluent-linux-grey',
    'fluent-grey': 'fluent-linux-grey',
    'fluent-color': 'fluent-ui-color',
  };
  const migrated = legacy[value] ?? value;
  return ICON_STYLES.includes(migrated) ? migrated : 'fluent-linux-color';
}

function fluentIconName(token, style) {
  const normalised = normaliseIconStyle(style);
  if (!token || normalised === 'system')
    return null;
  if (normalised === 'fluent-linux-color')
    return `workspace-hub-fluent-linux-color-${token}`;
  if (normalised === 'fluent-linux-grey')
    return `workspace-hub-fluent-linux-grey-${token}`;
  return `workspace-hub-fluent-ui-color-${token}`;
}

export function resolveTileIcon(item, style = 'fluent-linux-color') {
  const normalised = normaliseIconStyle(style);
  const semanticRole = item.type === 'web' ? normaliseWebIconRole(item.icon_role) : null;
  if (normalised === 'system')
    return (semanticRole ? SYSTEM_ROLE_ICONS[semanticRole] : null)
      || item.icon_name
      || SYSTEM_FALLBACK[item.type]
      || SYSTEM_FALLBACK.application;

  const token = semanticRole || FLUENT_BY_ID[item.id] || FLUENT_BY_TYPE[item.type] || null;
  // Unknown applications retain their real desktop application icon. The UI
  // detects a null result and asks Gio.DesktopAppInfo for that icon.
  if (!token && item.type === 'application')
    return null;
  return fluentIconName(token, normalised) || SYSTEM_FALLBACK[item.type] || SYSTEM_FALLBACK.application;
}

export function resolveSummaryIcon(summaryId, style = 'fluent-linux-color') {
  const normalised = normaliseIconStyle(style);
  if (normalised === 'system')
    return SYSTEM_SUMMARY_ICONS[summaryId] || 'view-app-grid-symbolic';
  return fluentIconName(SUMMARY_TOKENS[summaryId] || 'apps', normalised);
}

export function resolveStatusIcon(statusId, fallbackIcon, style = 'fluent-linux-color') {
  const normalised = normaliseIconStyle(style);
  if (normalised === 'system')
    return fallbackIcon || 'dialog-information-symbolic';
  return fluentIconName(STATUS_TOKENS[statusId] || 'apps', normalised);
}

export function iconStyleLabel(value) {
  return ({
    'fluent-linux-color': 'Fluent Linux Color',
    'fluent-linux-grey': 'Fluent Linux Grey',
    'fluent-ui-color': 'Fluent UI Color',
    system: 'Inherit Theme',
  })[normaliseIconStyle(value)];
}

export function iconStyleDescription(value) {
  return ({
    'fluent-linux-color': 'Use bundled colourful Fluent Linux icons across the dashboard.',
    'fluent-linux-grey': 'Use the bundled grey Fluent Linux folder and network style.',
    'fluent-ui-color': 'Use bundled colourful Microsoft Fluent UI icons across the dashboard.',
    system: 'Use installed application icons and icons inherited from your Linux desktop.',
  })[normaliseIconStyle(value)];
}
