import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function loadProfileStoreForNode() {
  const sourcePath = path.join(root, 'src/services/profile-store.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const bodyStart = source.indexOf('const DIRECTORY_NAME');
  assert.notEqual(bodyStart, -1, 'profile-store module body should be discoverable');

  const stubs = `
const fakeFiles = new Map();
const Gio = {
  File: {new_for_path: path => fakeFiles.get(path)},
  FileCopyFlags: {NONE: 0},
  FileCreateFlags: {REPLACE_DESTINATION: 0},
};
const GLib = {
  DateTime: {
    new_now_local: () => ({format: () => '20260806-201500'}),
    new_now_utc: () => ({format: () => '20260806T181500Z'}),
  },
  uuid_string_random: () => 'test-uuid',
};
const loggedErrors = [];
const logError = (error, message) => loggedErrors.push({error, message});
const normaliseWorkspaceLibrary = value => ({...value, normalised: true});
const createWorkspaceLibrary = () => ({kind: 'fallback'});
const cloneDefaultProfile = () => ({profile: {id: 'default'}});
const validateProfile = () => {};
const serializeWorkspaceLibrary = value => JSON.stringify(value) + '\\n';
const serializeProfile = value => JSON.stringify(value) + '\\n';
`;
  const transformed = `${stubs}\n${source.slice(bodyStart)}`
    .replace('export class ProfileStore', 'class ProfileStore')
    .concat('\nexport {ProfileStore, fakeFiles, loggedErrors};\n');
  const encoded = Buffer.from(transformed).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

function baseStore(ProfileStore) {
  const store = Object.create(ProfileStore.prototype);
  store.libraryPath = '/workspace-library.json';
  store.legacyProfilePath = '/workspace-profile.json';
  store.warning = null;
  store._persistenceBlockedReason = null;
  store._migrateLegacyProfile = () => null;
  return store;
}

test('a normalisation write failure is not misclassified as invalid workspace data', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  const file = {query_exists: () => true};
  fakeFiles.set(store.libraryPath, file);
  store._readJson = () => ({kind: 'valid'});

  let writeCalls = 0;
  let preserveCalls = 0;
  store._writeLibrary = () => {
    writeCalls += 1;
    if (writeCalls === 1)
      throw new Error('simulated write failure');
  };
  store._preserveInvalidFile = () => {
    preserveCalls += 1;
    return '/workspace-library.invalid.json';
  };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'valid');
  assert.equal(loaded.normalised, true);
  assert.equal(preserveCalls, 0);
  assert.equal(writeCalls, 1);
  assert.match(store.warning, /loaded.*changes are disabled/i);
  assert.match(store._persistenceBlockedReason, /could not be written/i);
});

test('failed invalid-data preservation never reports success or overwrites the original', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  let writeCalls = 0;
  const file = {
    query_exists: () => true,
    load_contents: () => { throw new Error('invalid JSON'); },
    move: () => { throw new Error('simulated preservation failure'); },
  };
  fakeFiles.set(store.libraryPath, file);
  store._readJson = () => { throw new SyntaxError('invalid JSON'); };
  store._writeLibrary = () => { writeCalls += 1; };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.equal(writeCalls, 0);
  assert.match(store.warning, /original.*untouched/i);
  assert.match(store._persistenceBlockedReason, /preserved safely/i);
});

test('a read failure preserves the original in place and does not attempt recovery writes', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  let preserveCalls = 0;
  let writeCalls = 0;
  fakeFiles.set(store.libraryPath, {
    query_exists: () => true,
    load_contents: () => { throw new Error('permission denied'); },
  });
  store._preserveInvalidFile = () => { preserveCalls += 1; };
  store._writeLibrary = () => { writeCalls += 1; };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.equal(preserveCalls, 0);
  assert.equal(writeCalls, 0);
  assert.match(store.warning, /could not be read.*original file is untouched/i);
  assert.match(store._persistenceBlockedReason, /changes are disabled/i);
});

test('invalid data is copied and verified before a fallback replaces the original', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  const preservedPath = `${store.libraryPath}.invalid-20260806-201500-test-uuid.json`;
  const destination = {query_exists: () => true};
  fakeFiles.set(preservedPath, destination);

  let copiedTo = null;
  let moved = false;
  let writeCalls = 0;
  const file = {
    query_exists: () => true,
    copy: target => { copiedTo = target; return true; },
    move: () => { moved = true; },
  };
  fakeFiles.set(store.libraryPath, file);
  store._readJson = () => { throw new SyntaxError('invalid JSON'); };
  store._writeLibrary = () => { writeCalls += 1; };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.equal(copiedTo, destination);
  assert.equal(moved, false);
  assert.equal(writeCalls, 1);
  assert.equal(store._persistenceBlockedReason, null);
  assert.match(store.warning, /recovery copy was created/i);
});

test('a failed fallback replacement remains write-blocked after a verified recovery copy', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  const preservedPath = `${store.libraryPath}.invalid-20260806-201500-test-uuid.json`;
  fakeFiles.set(preservedPath, {query_exists: () => true});
  fakeFiles.set(store.libraryPath, {
    query_exists: () => true,
    copy: () => true,
  });
  store._readJson = () => { throw new SyntaxError('invalid JSON'); };
  store._writeLibrary = () => { throw new Error('read-only filesystem'); };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.match(store.warning, /recovery copy was created.*could not be written/i);
  assert.match(store._persistenceBlockedReason, /changes are disabled/i);
});

test('write-blocked recovery mode rejects internal mutations before queueing them', async () => {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  store._persistenceBlockedReason = 'Workspace storage is write-blocked';
  let enqueueCalls = 0;
  store._libraryMutationQueue = {
    enqueue: () => { enqueueCalls += 1; return Promise.resolve(); },
  };
  store._mutationSequence = 0;

  await assert.rejects(
    store._enqueueLibraryMutation('save', () => {}),
    /write-blocked/
  );
  assert.equal(enqueueCalls, 0);
});

test('an unpreservable legacy profile does not create a replacement library', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  let writeCalls = 0;
  fakeFiles.set(store.libraryPath, {query_exists: () => false});
  fakeFiles.set(store.legacyProfilePath, {
    query_exists: () => true,
    copy: () => { throw new Error('legacy preservation failed'); },
  });
  store._readJson = () => { throw new SyntaxError('invalid legacy JSON'); };
  store._writeLibrary = () => { writeCalls += 1; };
  store._migrateLegacyProfile = ProfileStore.prototype._migrateLegacyProfile;

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.equal(writeCalls, 0);
  assert.match(store.warning, /previous workspace profile.*original file is untouched/i);
  assert.match(store._persistenceBlockedReason, /changes are disabled/i);
});

test('write-blocked view-state saves retain no pending values or drain promises', async () => {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  store._persistenceBlockedReason = 'Workspace storage is write-blocked';
  store.profile = {profile: {id: 'workspace-one'}};
  store._pendingViewStates = new Map();
  store._viewStateSavePromises = new Map();
  store._libraryMutationQueue = {
    hasPending: () => false,
    enqueue: () => Promise.resolve(),
  };
  store._mutationSequence = 0;

  await assert.rejects(
    store.saveViewState({profile: {id: 'workspace-one'}}),
    /write-blocked/
  );
  assert.equal(store._pendingViewStates.size, 0);
  assert.equal(store._viewStateSavePromises.size, 0);
});

test('a false load_contents result is treated as a read failure, not invalid JSON', async () => {
  const {ProfileStore, fakeFiles} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  let preserveCalls = 0;
  let writeCalls = 0;
  fakeFiles.set(store.libraryPath, {
    query_exists: () => true,
    load_contents: () => [false, new Uint8Array(), null],
  });
  store._preserveInvalidFile = () => { preserveCalls += 1; };
  store._writeLibrary = () => { writeCalls += 1; };

  const loaded = store._loadOrCreateLibrary();

  assert.equal(loaded.kind, 'fallback');
  assert.equal(preserveCalls, 0);
  assert.equal(writeCalls, 0);
  assert.match(store._persistenceBlockedReason, /could not be read/i);
});

test('a false replace_contents result is a write failure', async () => {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = baseStore(ProfileStore);
  const file = {
    replace_contents: () => [false, null],
  };

  assert.throws(
    () => store._writeLibrary(file, {kind: 'valid'}),
    /could not be confirmed/i
  );
});
