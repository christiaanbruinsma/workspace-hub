import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadProfileStoreForNode() {
  const source = fs.readFileSync(path.join(root, 'src/services/profile-store.js'), 'utf8');
  const bodyStart = source.indexOf('const DIRECTORY_NAME');
  assert.notEqual(bodyStart, -1);

  const stubs = `
const fakeFiles = new Map();
const Gio = {File: {new_for_path: path => fakeFiles.get(path)}};
const GLib = {build_filenamev: parts => parts.join('/')};
`;
  const transformed = `${stubs}\n${source.slice(bodyStart)}`
    .replace('export class ProfileStore', 'class ProfileStore')
    .concat('\nexport {ProfileStore, fakeFiles};\n');
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
}

test('Workspace History restore loads the selected active-workspace restore point and saves it transactionally', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = Object.create(ProfileStore.prototype);
  const restoreFile = '20260806T211500Z-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json';
  const restorePath = `/restore-points/${restoreFile}`;
  const file = {query_exists: () => true};
  fakeFiles.set(restorePath, file);
  store.restoreDirectoryPath = '/restore-points';
  store.getRestorePoints = () => [{restore_file: restoreFile}];
  const restoredProfile = {profile: {id: 'workspace-one', name: 'Example Workspace'}};
  store.loadExternal = selected => {
    assert.equal(selected, file);
    return restoredProfile;
  };
  let saveEvent = null;
  store.save = async (profile, event) => {
    assert.equal(profile, restoredProfile);
    saveEvent = event;
    store.profile = profile;
  };

  const result = await store.restoreRevision(restoreFile);

  assert.equal(result, restoredProfile);
  assert.deepEqual(saveEvent, {
    action: 'workspace-restored',
    summary: 'Restored Example Workspace',
    details: {restore_file: restoreFile},
  });
});

test('Workspace History restore rejects a restore point outside the active workspace', async () => {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = Object.create(ProfileStore.prototype);
  store.getRestorePoints = () => [];

  await assert.rejects(
    store.restoreRevision('20260806T211500Z-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json'),
    /does not belong to the active workspace/i
  );
});
