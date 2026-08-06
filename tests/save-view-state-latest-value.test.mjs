import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LibraryMutationQueue} from '../src/services/library-mutation-queue.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadProfileStoreForNode() {
  const sourcePath = path.join(root, 'src/services/profile-store.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const bodyStart = source.indexOf('const DIRECTORY_NAME');
  assert.notEqual(bodyStart, -1, 'profile-store module body should be discoverable');

  const stubs = `
const validateProfile = () => {};
const activeWorkspaceProfile = library => library.active_profile;
const replaceActiveWorkspace = (library, profile) => ({...library, active_profile: profile});
`;
  const transformed = `${stubs}\n${source.slice(bodyStart)}`
    .replace('export class ProfileStore', 'class ProfileStore')
    .concat('\nexport {ProfileStore};\n');
  const encoded = Buffer.from(transformed).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

function profile(activeTabId) {
  return {
    profile: {id: 'workspace-one'},
    settings: {
      section_tabs: {
        apps: {
          tabs: ['general', 'first', 'second', 'third', 'latest'].map(id => ({id})),
          active_tab_id: activeTabId,
        },
      },
    },
  };
}

async function createStore() {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = Object.create(ProfileStore.prototype);
  store._libraryMutationQueue = new LibraryMutationQueue();
  store._mutationSequence = 0;
  store._pendingViewStates = new Map();
  store._viewStateSavePromises = new Map();
  store.profile = profile('general');
  store.library = {
    active_workspace_id: 'workspace-one',
    active_profile: store.profile,
  };
  store._readCurrentLibraryState = () => ({library: store.library, etag: null});
  return store;
}

test('saveViewState commits a newer value submitted while the current mutation is still active', async () => {
  const store = await createStore();
  let submittedLatest = false;
  let latestPromise = null;

  store._runLibraryTransaction = buildCandidate => {
    const plan = buildCandidate(store.library);
    store.library = plan.candidateLibrary;
    store.profile = store.library.active_profile;

    if (!submittedLatest) {
      submittedLatest = true;
      latestPromise = store.saveViewState(profile('latest'));
    }
    return {historyWarning: null};
  };

  const firstPromise = store.saveViewState(profile('first'));
  await firstPromise;

  assert.equal(latestPromise, firstPromise);
  assert.equal(store.profile.settings.section_tabs.apps.active_tab_id, 'latest');
  assert.equal(store._pendingViewStates.size, 0);
  assert.equal(store._viewStateSavePromises.size, 0);
});

test('saveViewState coalesces rapid updates and commits the latest submitted value', async () => {
  const store = await createStore();
  const committed = [];
  let injected = false;
  let secondPromise = null;
  let thirdPromise = null;

  store._runLibraryTransaction = buildCandidate => {
    const plan = buildCandidate(store.library);
    store.library = plan.candidateLibrary;
    store.profile = store.library.active_profile;
    committed.push(store.profile.settings.section_tabs.apps.active_tab_id);
    store.profile.profile.name = 'Preserved latest metadata';
    store.library.active_profile.profile.name = 'Preserved latest metadata';

    if (!injected) {
      injected = true;
      secondPromise = store.saveViewState(profile('second'));
      thirdPromise = store.saveViewState(profile('third'));
    }
    return {historyWarning: null};
  };

  const firstPromise = store.saveViewState(profile('first'));
  await firstPromise;

  assert.equal(secondPromise, firstPromise);
  assert.equal(thirdPromise, firstPromise);
  assert.deepEqual(committed, ['first', 'third']);
  assert.equal(store.profile.settings.section_tabs.apps.active_tab_id, 'third');
  assert.equal(store.profile.profile.name, 'Preserved latest metadata');
  assert.equal(store._pendingViewStates.size, 0);
  assert.equal(store._viewStateSavePromises.size, 0);
});

test('saveViewState releases a failed drain so a later save can retry', async () => {
  const store = await createStore();
  let fail = true;

  store._runLibraryTransaction = buildCandidate => {
    if (fail) {
      fail = false;
      throw new Error('simulated persistence failure');
    }
    const plan = buildCandidate(store.library);
    store.library = plan.candidateLibrary;
    store.profile = store.library.active_profile;
    return {historyWarning: null};
  };

  await assert.rejects(
    store.saveViewState(profile('first')),
    /simulated persistence failure/
  );
  assert.equal(store._viewStateSavePromises.size, 0);

  await store.saveViewState(profile('latest'));
  assert.equal(store.profile.settings.section_tabs.apps.active_tab_id, 'latest');
  assert.equal(store._viewStateSavePromises.size, 0);
});
