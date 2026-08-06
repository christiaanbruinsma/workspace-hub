import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DIRECTORY_NAME = 'workspace-hub';
const FILE_NAME = 'workspace-health-cache.json';
const MAX_CACHE_BYTES = 512 * 1024;

function decode(contents) {
  return new TextDecoder().decode(contents);
}

export class HealthStore {
  constructor() {
    this.directoryPath = GLib.build_filenamev([GLib.get_user_config_dir(), DIRECTORY_NAME]);
    this.path = GLib.build_filenamev([this.directoryPath, FILE_NAME]);
    GLib.mkdir_with_parents(this.directoryPath, 0o700);
    this.entries = this._load();
  }

  _load() {
    const file = Gio.File.new_for_path(this.path);
    if (!file.query_exists(null))
      return {};
    try {
      const [, contents] = file.load_contents(null);
      if (contents.length > MAX_CACHE_BYTES)
        throw new Error('Workspace health cache is larger than the supported limit');
      const parsed = JSON.parse(decode(contents));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      logError(error, 'Unable to read Workspace Hub health cache');
      return {};
    }
  }

  _save() {
    const bytes = new TextEncoder().encode(`${JSON.stringify(this.entries, null, 2)}\n`);
    Gio.File.new_for_path(this.path).replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
  }

  getRemoteResult(item) {
    const entry = this.entries[item.id];
    if (!entry || entry.target !== item.uri)
      return null;
    return {...entry};
  }

  setRemoteResult(item, result) {
    this.entries[item.id] = {
      target: item.uri,
      status: result.status,
      detail: result.detail,
      checked_at: GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S%z'),
    };
    this._save();
    return this.entries[item.id];
  }
}
