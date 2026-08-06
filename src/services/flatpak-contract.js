export const FLATPAK_LIST_COLUMNS = Object.freeze([
  'application',
  'name',
  'installation',
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function normaliseFlatpakInstallation(value) {
  const installation = clean(value).toLocaleLowerCase();
  if (installation === 'user')
    return {installation:'user', source:'flatpak-user'};
  return {installation:installation || 'system', source:'flatpak-system'};
}

export function parseFlatpakListOutput(output, installationHint = '') {
  const applications = [];
  const seen = new Set();
  for (const rawLine of String(output ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line)
      continue;

    const fields = rawLine.split('\t').map(clean);
    if (fields.length < 2)
      continue;

    const [application, name, installationValue = installationHint] = fields;
    if (!application || application.toLocaleLowerCase() === 'application')
      continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(application))
      continue;

    const {installation, source} = normaliseFlatpakInstallation(installationValue || installationHint);
    const key = `${source}:${application}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    applications.push({
      application,
      name:name || application,
      installation,
      source,
    });
  }
  return applications;
}

function wrapHost(command, sandboxed) {
  return sandboxed ? ['flatpak-spawn', '--host', ...command] : command;
}

export function flatpakListCommands(sandboxed) {
  return [
    {
      installationHint:'user',
      argv:wrapHost([
        'flatpak', '--user', 'list', '--app', '--columns=application:full,name:full',
      ], sandboxed),
    },
    {
      installationHint:'system',
      argv:wrapHost([
        'flatpak', '--system', 'list', '--app', '--columns=application:full,name:full',
      ], sandboxed),
    },
    {
      installationHint:'',
      argv:wrapHost([
        'flatpak', 'list', '--app',
        `--columns=${FLATPAK_LIST_COLUMNS.map(column => `${column}:full`).join(',')}`,
      ], sandboxed),
    },
  ];
}

export function flatpakRunCommand(application, source, sandboxed, installation = '') {
  const appId = clean(application);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(appId))
    throw new Error('Invalid Flatpak application identifier.');

  const normalisedInstallation = clean(installation);
  const scope = source === 'flatpak-user'
    ? '--user'
    : normalisedInstallation && normalisedInstallation !== 'system'
      ? `--installation=${normalisedInstallation}`
      : '--system';
  const command = ['flatpak', scope, 'run', appId];
  return sandboxed ? ['flatpak-spawn', '--host', ...command] : command;
}
