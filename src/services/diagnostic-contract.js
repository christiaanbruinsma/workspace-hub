function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function summariseDiagnostics(checks) {
  const summary = {
    total: checks.length,
    available: 0,
    configured: 0,
    attention: 0,
    notChecked: 0,
    applications: {total: 0, available: 0, missing: 0},
    websites: {total: 0, valid: 0, invalid: 0},
    places: {total: 0, available: 0, missing: 0, remoteConfigured: 0, remoteAvailable: 0, remoteUnavailable: 0},
  };

  for (const check of checks) {
    if (check.status === 'available' || check.status === 'supported' || check.status === 'remote-available')
      summary.available += 1;
    else if (check.status === 'valid')
      summary.configured += 1;
    else if (check.status === 'not-checked')
      summary.notChecked += 1;
    else
      summary.attention += 1;

    if (check.type === 'application') {
      summary.applications.total += 1;
      if (check.status === 'available') summary.applications.available += 1;
      if (check.status === 'missing') summary.applications.missing += 1;
    } else if (check.type === 'web') {
      summary.websites.total += 1;
      if (check.status === 'valid') summary.websites.valid += 1;
      if (check.status === 'invalid') summary.websites.invalid += 1;
    } else if (check.type === 'place') {
      summary.places.total += 1;
      if (check.status === 'available') summary.places.available += 1;
      if (check.status === 'missing') summary.places.missing += 1;
      if (check.status === 'not-checked') summary.places.remoteConfigured += 1;
      if (check.status === 'remote-available') summary.places.remoteAvailable += 1;
      if (check.status === 'remote-unavailable') summary.places.remoteUnavailable += 1;
    }
  }
  return summary;
}

export function redactDiagnosticTarget(item, homeDirectory = '') {
  if (item.type === 'application')
    return item.desktop_id;
  if (item.type === 'web') {
    if (/^mailto:/i.test(item.url))
      return 'mailto:[redacted]';
    if (!/^https?:/i.test(item.url))
      return '[invalid web address]';
    return item.url.split(/[?#]/, 1)[0];
  }
  if (item.type === 'place') {
    if (item.uri.startsWith('~/'))
      return item.uri;
    if (homeDirectory && item.uri.startsWith(homeDirectory))
      return `~${item.uri.slice(homeDirectory.length)}`;
    if (homeDirectory && item.uri.startsWith(`file://${homeDirectory}`))
      return `file://~${item.uri.slice(`file://${homeDirectory}`.length)}`;
    return item.uri;
  }
  if (item.type === 'action')
    return item.action;
  return '[unknown]';
}

export function buildDiagnosticReport({profile, checks, appVersion, generatedAt, platform, homeDirectory = ''}) {
  const summary = summariseDiagnostics(checks);
  return {
    format: 'workspace-hub-diagnostic-report',
    schema_version: 1,
    generated_at: generatedAt,
    application: {
      name: 'Workspace Hub',
      version: appVersion,
    },
    platform: clone(platform),
    profile: {
      id: profile.profile.id,
      name: profile.profile.name,
      revision: profile.profile.revision || '',
      source: profile.profile.source,
      schema_version: profile.schema_version,
    },
    summary,
    checks: checks.map(check => ({
      id: check.id,
      section: check.section,
      type: check.type,
      title: check.title,
      status: check.status,
      detail: check.detail,
      checked_at: check.checkedAt ?? null,
      manual: check.manual ?? false,
      application_source: check.type === 'application' ? (check.item.application_source || 'unknown') : null,
      target: redactDiagnosticTarget(check.item, homeDirectory),
    })),
    privacy: {
      includes_passwords: false,
      includes_tokens: false,
      includes_document_contents: false,
      url_queries_removed: true,
      mail_addresses_redacted: true,
      home_paths_shortened: true,
    },
  };
}
