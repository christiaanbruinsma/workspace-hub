import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {createEmptyProfile} from '../src/services/default-profile.js';
import {createExampleWorkspaceProfile} from '../src/services/example-workspace.js';
import {ProfileStore} from '../src/services/profile-store.js';
import {createWorkspaceLibrary} from '../src/services/workspace-library-contract.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const library = createWorkspaceLibrary(createEmptyProfile());
const example = createExampleWorkspaceProfile(library, {id: 'example-gjs'});
assert(example.profile.id === 'example-gjs', 'Example workspace should use the supplied unique id');
assert(example.settings.setup_completed === true, 'Example workspace should not reopen first-run onboarding');
assert(example.sections.apps.length > 0, 'Example workspace should contain sample applications');

const temporaryDirectory = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `workspace-hub-restore-${GLib.uuid_string_random()}`,
]);
GLib.mkdir_with_parents(temporaryDirectory, 0o700);
const restoreFile = '20260806T211500Z-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json';
const restorePath = GLib.build_filenamev([temporaryDirectory, restoreFile]);
GLib.file_set_contents(restorePath, '{}');

try {
  const store = Object.create(ProfileStore.prototype);
  const restoredProfile = {profile: {id: 'workspace-one', name: 'Example Workspace'}};
  store.restoreDirectoryPath = temporaryDirectory;
  store.getRestorePoints = () => [{restore_file: restoreFile}];
  store.loadExternal = file => {
    assert(file.get_path() === restorePath, 'Restore should open the selected restore file');
    return restoredProfile;
  };
  let savedEvent = null;
  store.save = async (profile, event) => {
    assert(profile === restoredProfile, 'Restore should save the loaded profile');
    savedEvent = event;
    store.profile = profile;
  };

  const result = await store.restoreRevision(restoreFile);
  assert(result === restoredProfile, 'Restore should resolve to the restored active profile');
  assert(savedEvent?.action === 'workspace-restored', 'Restore should record a workspace-restored event');
  assert(savedEvent?.details?.restore_file === restoreFile, 'Restore history should retain the restore file id');
} finally {
  const restore = Gio.File.new_for_path(restorePath);
  if (restore.query_exists(null))
    restore.delete(null);
  const directory = Gio.File.new_for_path(temporaryDirectory);
  if (directory.query_exists(null))
    directory.delete(null);
}
