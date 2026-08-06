import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function writeText(path, text) {
  const bytes = new TextEncoder().encode(text);
  Gio.File.new_for_path(path).replace_contents(
    bytes,
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
  );
}

function readText(path) {
  const [, contents] = Gio.File.new_for_path(path).load_contents(null);
  return new TextDecoder().decode(contents);
}

const tempRoot = GLib.dir_make_tmp('workspace-hub-persistence-recovery-XXXXXX');
const originalConfigHome = GLib.getenv('XDG_CONFIG_HOME');

try {
  GLib.setenv('XDG_CONFIG_HOME', tempRoot, true);
  const {ProfileStore} = await import('../src/services/profile-store.js');
  const workspaceDirectory = GLib.build_filenamev([tempRoot, 'workspace-hub']);
  GLib.mkdir_with_parents(workspaceDirectory, 0o700);
  const libraryPath = GLib.build_filenamev([workspaceDirectory, 'workspace-library.json']);
  writeText(libraryPath, '{invalid-json');

  const store = new ProfileStore();
  assert(store._persistenceBlockedReason === null, 'verified recovery should remain writable');
  assert(store.warning?.includes('recovery copy was created'), 'successful recovery should report its copy');
  assert(readText(libraryPath).includes('workspace-library'), 'invalid original should be replaced with a valid fallback');

  const entries = Gio.File.new_for_path(workspaceDirectory).enumerate_children(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    null
  );
  let recoveryCopyFound = false;
  let info;
  while ((info = entries.next_file(null)) !== null) {
    if (info.get_name().startsWith('workspace-library.json.invalid-'))
      recoveryCopyFound = true;
  }
  entries.close(null);
  assert(recoveryCopyFound, 'successful recovery should leave a verified recovery copy');

  const directStore = Object.create(ProfileStore.prototype);

  let falseReadThrew = false;
  try {
    directStore._loadContents({load_contents: () => [false, new Uint8Array(), null]});
  } catch (error) {
    falseReadThrew = error.name === 'WorkspaceDataReadError';
  }
  assert(falseReadThrew, 'false load_contents results must be treated as read failures');

  let falseWriteThrew = false;
  try {
    directStore._replaceContents({replace_contents: () => [false, null]}, new Uint8Array());
  } catch (error) {
    falseWriteThrew = /could not be confirmed/.test(error.message);
  }
  assert(falseWriteThrew, 'false replace_contents results must be treated as write failures');

  let preservationThrew = false;
  try {
    directStore._preserveInvalidFile({
      copy() {
        throw new Error('simulated copy failure');
      },
    }, libraryPath);
  } catch (error) {
    preservationThrew = /simulated copy failure/.test(error.message);
  }
  assert(preservationThrew, 'preservation failures must propagate instead of reporting success');

  directStore._persistenceBlockedReason = 'Workspace storage is write-blocked';
  directStore._mutationSequence = 0;
  let enqueueCalls = 0;
  directStore._libraryMutationQueue = {
    enqueue() {
      enqueueCalls += 1;
      return Promise.resolve();
    },
  };
  let rejected = false;
  try {
    await directStore._enqueueLibraryMutation('save', () => {});
  } catch (error) {
    rejected = /write-blocked/.test(error.message);
  }
  assert(rejected, 'write-blocked mutations should reject with the recovery reason');
  assert(enqueueCalls === 0, 'write-blocked mutations must not enter the queue');
} finally {
  if (originalConfigHome === null)
    GLib.unsetenv('XDG_CONFIG_HOME');
  else
    GLib.setenv('XDG_CONFIG_HOME', originalConfigHome, true);

  const root = Gio.File.new_for_path(tempRoot);
  try {
    const deleteRecursively = file => {
      if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
        const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let childInfo;
        while ((childInfo = enumerator.next_file(null)) !== null)
          deleteRecursively(file.get_child(childInfo.get_name()));
        enumerator.close(null);
      }
      file.delete(null);
    };
    deleteRecursively(root);
  } catch (error) {
    logError(error, 'Unable to remove persistence recovery test data');
  }
}
