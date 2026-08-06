import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {flatpakListCommands, flatpakRunCommand, parseFlatpakListOutput} from './flatpak-contract.js';

export const APPLICATION_SOURCES = Object.freeze([
  'system',
  'flatpak-system',
  'flatpak-user',
  'snap',
  'user',
  'sandbox',
  'unknown',
]);

const SOURCE_LABELS = Object.freeze({
  system: 'System package',
  'flatpak-system': 'Flatpak · system',
  'flatpak-user': 'Flatpak · user',
  snap: 'Snap',
  user: 'User application',
  sandbox: 'Workspace runtime',
  unknown: 'Unknown source',
});

function pathExists(path) {
  try {
    return Gio.File.new_for_path(path).query_exists(null);
  } catch (_error) {
    return false;
  }
}

function safeString(keyFile, group, key, fallback = '') {
  try {
    return keyFile.get_locale_string(group, key, null) || fallback;
  } catch (_error) {
    try {
      return keyFile.get_string(group, key) || fallback;
    } catch (_nestedError) {
      return fallback;
    }
  }
}

function safeBoolean(keyFile, group, key, fallback = false) {
  try {
    return keyFile.get_boolean(group, key);
  } catch (_error) {
    return fallback;
  }
}

function sourceRank(source) {
  return ({user:0, 'flatpak-user':1, system:2, snap:3, 'flatpak-system':4, sandbox:5, unknown:6})[source] ?? 9;
}

function sourceDirectories() {
  const home = GLib.get_home_dir();
  const sandboxed = Boolean(GLib.getenv('FLATPAK_ID'));
  const directories = [
    {
      path: GLib.build_filenamev([home, '.local', 'share', 'applications']),
      hostPath: GLib.build_filenamev([home, '.local', 'share', 'applications']),
      source: 'user',
    },
    {
      path: GLib.build_filenamev([home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications']),
      hostPath: GLib.build_filenamev([home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications']),
      source: 'flatpak-user',
    },
    {
      path: '/var/lib/flatpak/exports/share/applications',
      hostPath: '/var/lib/flatpak/exports/share/applications',
      source: 'flatpak-system',
    },
    {
      path: '/var/lib/snapd/desktop/applications',
      hostPath: '/var/lib/snapd/desktop/applications',
      source: 'snap',
    },
  ];

  if (sandboxed) {
    directories.push(
      {path:'/run/host/usr/local/share/applications', hostPath:'/usr/local/share/applications', source:'system'},
      {path:'/run/host/usr/share/applications', hostPath:'/usr/share/applications', source:'system'},
    );
  } else {
    directories.push(
      {path:'/usr/local/share/applications', hostPath:'/usr/local/share/applications', source:'system'},
      {path:'/usr/share/applications', hostPath:'/usr/share/applications', source:'system'},
    );
  }
  return directories;
}

function enumerateDesktopFiles(directory, depth = 0) {
  if (depth > 2 || !pathExists(directory.path))
    return [];

  const results = [];
  const root = Gio.File.new_for_path(directory.path);
  let enumerator = null;
  try {
    enumerator = root.enumerate_children(
      'standard::name,standard::type',
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    let info = null;
    while ((info = enumerator.next_file(null)) !== null) {
      const name = info.get_name();
      const childPath = GLib.build_filenamev([directory.path, name]);
      const hostChildPath = GLib.build_filenamev([directory.hostPath, name]);
      if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        results.push(...enumerateDesktopFiles({...directory, path:childPath, hostPath:hostChildPath}, depth + 1));
      } else if (name.endsWith('.desktop')) {
        results.push({path:childPath, hostPath:hostChildPath, source:directory.source});
      }
    }
  } catch (error) {
    console.debug(`[Workspace Hub] Could not enumerate ${directory.path}: ${error.message}`);
  } finally {
    try {
      enumerator?.close(null);
    } catch (_error) {
      // The directory may already have been closed after an enumeration error.
    }
  }
  return results;
}

function desktopEntryFromFile(candidate) {
  const keyFile = new GLib.KeyFile();
  try {
    keyFile.load_from_file(candidate.path, GLib.KeyFileFlags.NONE);
  } catch (_error) {
    return null;
  }

  const group = 'Desktop Entry';
  if (safeString(keyFile, group, 'Type', 'Application') !== 'Application')
    return null;
  if (safeBoolean(keyFile, group, 'Hidden') || safeBoolean(keyFile, group, 'NoDisplay'))
    return null;

  const name = safeString(keyFile, group, 'Name').trim();
  if (!name)
    return null;

  const desktopId = GLib.path_get_basename(candidate.path);
  const iconName = safeString(keyFile, group, 'Icon').trim();
  const description = safeString(keyFile, group, 'Comment', safeString(keyFile, group, 'GenericName')).trim();
  return {
    key: `${candidate.source}:${desktopId}`,
    desktopId,
    name,
    description,
    iconName,
    source: candidate.source,
    sourceLabel: SOURCE_LABELS[candidate.source] ?? SOURCE_LABELS.unknown,
    desktopFile: candidate.path,
    hostDesktopFile: candidate.hostPath,
    defaultRoles: [],
  };
}

function mimeAppsCandidates() {
  const home = GLib.get_home_dir();
  const sandboxed = Boolean(GLib.getenv('FLATPAK_ID'));
  const candidates = [
    GLib.build_filenamev([home, '.config', 'mimeapps.list']),
    GLib.build_filenamev([home, '.local', 'share', 'applications', 'mimeapps.list']),
  ];
  if (sandboxed) {
    candidates.push(
      '/run/host/etc/xdg/mimeapps.list',
      '/run/host/usr/local/share/applications/mimeapps.list',
      '/run/host/usr/share/applications/mimeapps.list',
      '/run/host/usr/share/applications/defaults.list',
    );
  } else {
    candidates.push(
      '/etc/xdg/mimeapps.list',
      '/usr/local/share/applications/mimeapps.list',
      '/usr/share/applications/mimeapps.list',
      '/usr/share/applications/defaults.list',
    );
  }
  return candidates;
}

function defaultDesktopIdForScheme(scheme) {
  const key = `x-scheme-handler/${scheme}`;
  for (const path of mimeAppsCandidates()) {
    if (!pathExists(path))
      continue;
    const keyFile = new GLib.KeyFile();
    try {
      keyFile.load_from_file(path, GLib.KeyFileFlags.NONE);
      const value = keyFile.get_string('Default Applications', key);
      const desktopId = String(value ?? '').split(';').map(entry => entry.trim()).find(Boolean);
      if (desktopId)
        return desktopId;
    } catch (_error) {
      // Continue with the next standard mimeapps.list location.
    }
  }

  try {
    return Gio.AppInfo.get_default_for_uri_scheme(scheme)?.get_id?.() || '';
  } catch (_error) {
    return '';
  }
}

function normaliseSearch(value) {
  return String(value ?? '').normalize('NFKD').toLocaleLowerCase();
}

function commandAvailable(argv) {
  const executable = argv[0];
  return Boolean(GLib.find_program_in_path(executable));
}

function runTextCommand(argv) {
  if (!commandAvailable(argv))
    return '';
  try {
    const process = Gio.Subprocess.new(
      argv,
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const [stdout, stderr] = process.communicate_utf8(null, null);
    if (!process.get_successful()) {
      console.debug(`[Workspace Hub] Command failed: ${argv.join(' ')}: ${String(stderr ?? '').trim()}`);
      return '';
    }
    return String(stdout ?? '');
  } catch (error) {
    console.debug(`[Workspace Hub] Could not run ${argv.join(' ')}: ${error.message}`);
    return '';
  }
}

function flatpakDeploymentRoots() {
  return [
    {
      path: GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'flatpak', 'app']),
      installation: 'user',
      source: 'flatpak-user',
    },
    {
      path: '/var/lib/flatpak/app',
      installation: 'system',
      source: 'flatpak-system',
    },
  ];
}

function discoverFlatpakDeployments() {
  const applications = [];
  for (const root of flatpakDeploymentRoots()) {
    if (!pathExists(root.path))
      continue;
    let enumerator = null;
    try {
      enumerator = Gio.File.new_for_path(root.path).enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      let info = null;
      while ((info = enumerator.next_file(null)) !== null) {
        const application = info.get_name();
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
          continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/.test(application))
          continue;
        applications.push({
          application,
          name: application,
          installation: root.installation,
          source: root.source,
        });
      }
    } catch (error) {
      console.debug(`[Workspace Hub] Could not inspect Flatpak deployments at ${root.path}: ${error.message}`);
    } finally {
      try {
        enumerator?.close(null);
      } catch (_error) {
        // The directory may already have been closed after an enumeration error.
      }
    }
  }
  return applications;
}

function discoverFlatpakInstallations() {
  const sandboxed = Boolean(GLib.getenv('FLATPAK_ID'));
  const applications = new Map();
  for (const query of flatpakListCommands(sandboxed)) {
    const output = runTextCommand(query.argv);
    for (const entry of parseFlatpakListOutput(output, query.installationHint))
      applications.set(`${entry.source}:${entry.application}`, entry);
  }

  // Read-only deployment roots are a compatibility fallback for Builder and
  // production sandboxes where flatpak-spawn or a particular Flatpak query is
  // unavailable. Directory names are stable application IDs; richer desktop
  // metadata is merged later whenever an exported .desktop file is visible.
  for (const entry of discoverFlatpakDeployments()) {
    const key = `${entry.source}:${entry.application}`;
    if (!applications.has(key))
      applications.set(key, entry);
  }
  return [...applications.values()];
}

function flatpakExportPaths(entry) {
  const desktopId = `${entry.application}.desktop`;
  if (entry.source === 'flatpak-user') {
    const path = GLib.build_filenamev([
      GLib.get_home_dir(), '.local', 'share', 'flatpak', 'exports', 'share', 'applications', desktopId,
    ]);
    return {desktopId, desktopFile:path, hostDesktopFile:path};
  }
  const hostDesktopFile = `/var/lib/flatpak/exports/share/applications/${desktopId}`;
  return {desktopId, desktopFile:hostDesktopFile, hostDesktopFile};
}

function flatpakCatalogItem(entry) {
  const {desktopId, desktopFile, hostDesktopFile} = flatpakExportPaths(entry);
  return {
    key: `${entry.source}:${desktopId}`,
    desktopId,
    name: entry.name || entry.application,
    description: 'Flatpak application',
    iconName: entry.application,
    source: entry.source,
    sourceLabel: SOURCE_LABELS[entry.source] ?? SOURCE_LABELS.unknown,
    desktopFile,
    hostDesktopFile,
    flatpakAppId: entry.application,
    flatpakInstallation: entry.installation,
    defaultRoles: [],
  };
}

export class ApplicationCatalog {
  constructor() {
    this._applications = this._discover();
  }

  refresh() {
    this._applications = this._discover();
    return this.list();
  }

  list() {
    return this._applications.map(item => ({...item, defaultRoles:[...item.defaultRoles]}));
  }

  search(query) {
    const needle = normaliseSearch(query).trim();
    if (!needle)
      return this.list();
    return this._applications
      .filter(item => normaliseSearch(`${item.name} ${item.description} ${item.sourceLabel} ${item.desktopId}`).includes(needle))
      .map(item => ({...item, defaultRoles:[...item.defaultRoles]}));
  }

  resolveItem(item) {
    if (!item?.desktop_id)
      return null;
    const source = item.application_source && item.application_source !== 'unknown'
      ? item.application_source
      : null;
    const requestedId = String(item.desktop_id).replace(/\.desktop$/, '');
    const exact = this._applications.find(app => (
      app.desktopId === item.desktop_id || app.flatpakAppId === requestedId
    ) && (!source || app.source === source));
    if (exact)
      return exact;

    const expectedNames = new Set([item.subtitle, item.title].filter(Boolean).map(normaliseSearch));
    return this._applications.find(app => app.desktopId === item.desktop_id || app.flatpakAppId === requestedId)
      ?? this._applications.find(app => expectedNames.has(normaliseSearch(app.name)))
      ?? null;
  }

  defaultForScheme(scheme) {
    const desktopId = defaultDesktopIdForScheme(scheme);
    return desktopId ? this._applications.find(app => app.desktopId === desktopId) ?? null : null;
  }

  iconFor(application) {
    if (!application)
      return null;
    const iconName = String(application.iconName ?? '').trim();
    if (!iconName)
      return null;
    if (GLib.path_is_absolute(iconName)) {
      let accessiblePath = iconName;
      if (Boolean(GLib.getenv('FLATPAK_ID')) && iconName.startsWith('/usr/'))
        accessiblePath = `/run/host${iconName}`;
      if (pathExists(accessiblePath))
        return new Gio.FileIcon({file:Gio.File.new_for_path(accessiblePath)});
    }
    try {
      return Gio.Icon.new_for_string(iconName);
    } catch (_error) {
      return new Gio.ThemedIcon({name:iconName});
    }
  }

  launchWorkspaceItem(item, callback) {
    const application = this.resolveItem(item);
    if (!application) {
      callback(new Error(`${item.subtitle || item.title} is not installed or is not visible to Workspace Hub.`));
      return;
    }

    const sandboxed = Boolean(GLib.getenv('FLATPAK_ID'));
    if (application.flatpakAppId) {
      const argv = flatpakRunCommand(
        application.flatpakAppId,
        application.source,
        sandboxed,
        application.flatpakInstallation,
      );
      if (!commandAvailable(argv)) {
        callback(new Error(sandboxed ? 'The Flatpak host launcher is unavailable.' : 'Flatpak is unavailable.'));
        return;
      }
      try {
        const process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
        process.wait_check_async(null, (source, result) => {
          try {
            source.wait_check_finish(result);
            callback(null);
          } catch (error) {
            callback(error);
          }
        });
      } catch (error) {
        callback(error);
      }
      return;
    }

    if (sandboxed && application.source !== 'sandbox') {
      if (!GLib.find_program_in_path('flatpak-spawn')) {
        callback(new Error('The Flatpak host launcher is unavailable.'));
        return;
      }
      try {
        const process = Gio.Subprocess.new(
          ['flatpak-spawn', '--host', 'gio', 'launch', application.hostDesktopFile],
          Gio.SubprocessFlags.STDERR_PIPE,
        );
        process.wait_check_async(null, (source, result) => {
          try {
            source.wait_check_finish(result);
            callback(null);
          } catch (error) {
            callback(error);
          }
        });
      } catch (error) {
        callback(error);
      }
      return;
    }

    try {
      const appInfo = Gio.DesktopAppInfo.new_from_filename(application.desktopFile)
        ?? Gio.DesktopAppInfo.new(application.desktopId);
      if (!appInfo)
        throw new Error(`Could not open ${application.name}.`);
      appInfo.launch([], null);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  _discover() {
    const discovered = [];
    const seen = new Set();
    for (const directory of sourceDirectories()) {
      for (const candidate of enumerateDesktopFiles(directory)) {
        const item = desktopEntryFromFile(candidate);
        if (!item || seen.has(item.key))
          continue;
        seen.add(item.key);
        discovered.push(item);
      }
    }

    const byKey = new Map(discovered.map(item => [item.key, item]));
    for (const flatpakEntry of discoverFlatpakInstallations()) {
      const cliItem = flatpakCatalogItem(flatpakEntry);
      const existing = byKey.get(cliItem.key)
        ?? discovered.find(item => item.source === cliItem.source && item.desktopId === cliItem.desktopId);
      if (existing) {
        existing.flatpakAppId = cliItem.flatpakAppId;
        existing.flatpakInstallation = cliItem.flatpakInstallation;
        if (!existing.name || existing.name === existing.desktopId)
          existing.name = cliItem.name;
        continue;
      }
      byKey.set(cliItem.key, cliItem);
      discovered.push(cliItem);
    }

    const defaultMail = defaultDesktopIdForScheme('mailto');
    const defaultBrowser = defaultDesktopIdForScheme('https');
    for (const item of discovered) {
      if (item.desktopId === defaultMail)
        item.defaultRoles.push('Default email application');
      if (item.desktopId === defaultBrowser)
        item.defaultRoles.push('Default web browser');
    }

    return discovered.sort((a, b) => {
      const roleDifference = Number(b.defaultRoles.length > 0) - Number(a.defaultRoles.length > 0);
      if (roleDifference !== 0)
        return roleDifference;
      const nameDifference = a.name.localeCompare(b.name);
      return nameDifference !== 0 ? nameDifference : sourceRank(a.source) - sourceRank(b.source);
    });
  }
}
