import test from 'node:test';
import assert from 'node:assert/strict';

import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {addWorkspace, createWorkspaceLibrary, workspaceProfile} from '../src/services/workspace-library-contract.js';
import {executeLibraryTransaction} from '../src/services/library-transaction.js';
import {
  buildWorkspaceContentsCopyPlan,
  replaceWorkspaceContents,
  workspaceContentsCopyDestinations,
} from '../src/services/workspace-contents-copy.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureLibrary() {
  const source = cloneDefaultProfile();
  source.profile.id = 'source-workspace';
  source.profile.name = 'Source Workspace';
  source.profile.organisation = 'Source Org';
  source.profile.revision = 'source-r1';
  source.profile.managed_by = 'Source Admin';
  source.profile.source = 'local';
  source.settings.greeting_name = 'Source User';
  source.settings.icon_style = 'fluent-ui-color';
  source.settings.section_tabs.apps = {
    tabs: [
      {id: 'general', title: 'General', position: 1, is_default: true},
      {id: 'creative', title: 'Creative', position: 2, is_default: false},
    ],
    active_tab_id: 'creative',
  };
  source.sections.apps[0].tab_id = 'creative';

  const target = createEmptyProfile();
  target.profile.id = 'target-workspace';
  target.profile.name = 'Target Workspace';
  target.profile.organisation = 'Target Org';
  target.profile.revision = 'target-r9';
  target.profile.managed_by = 'Target Admin';
  target.profile.source = 'imported';
  target.settings.icon_style = 'system';
  target.sections.apps = [{
    id: 'target-only', type: 'application', tab_id: 'general', title: 'Target only', subtitle: '',
    icon_name: 'application-x-executable-symbolic', desktop_id: 'target.desktop', application_source: 'unknown',
    icon_override: 'inherit', origin: 'local', locked: false, position: 1, enabled: true,
  }];

  const untouched = createEmptyProfile();
  untouched.profile.id = 'untouched-workspace';
  untouched.profile.name = 'Untouched Workspace';

  let library = createWorkspaceLibrary(source);
  library = addWorkspace(library, target);
  library = addWorkspace(library, untouched);
  return library;
}

test('replaceWorkspaceContents overwrites target contents while preserving target identity', () => {
  const library = fixtureLibrary();
  const beforeSource = clone(workspaceProfile(library, 'source-workspace'));
  const beforeTarget = clone(workspaceProfile(library, 'target-workspace'));
  const beforeUntouched = clone(workspaceProfile(library, 'untouched-workspace'));

  const next = replaceWorkspaceContents(library, 'source-workspace', 'target-workspace');
  const source = workspaceProfile(next, 'source-workspace');
  const target = workspaceProfile(next, 'target-workspace');
  const untouched = workspaceProfile(next, 'untouched-workspace');

  assert.deepEqual(source, beforeSource);
  assert.deepEqual(untouched, beforeUntouched);
  assert.deepEqual(target.profile, beforeTarget.profile);
  assert.deepEqual(target.settings, beforeSource.settings);
  assert.deepEqual(target.sections, beforeSource.sections);
  assert.deepEqual(target.status, beforeSource.status);
  assert.equal(next.active_workspace_id, library.active_workspace_id);
});

test('buildWorkspaceContentsCopyPlan creates a target restore point and history record', () => {
  const library = fixtureLibrary();
  const oldTarget = workspaceProfile(library, 'target-workspace');
  const plan = buildWorkspaceContentsCopyPlan(library, {
    sourceWorkspaceId: 'source-workspace',
    targetWorkspaceId: 'target-workspace',
  });

  assert.deepEqual(plan.restorePoints, [{workspaceId: 'target-workspace', profile: oldTarget}]);
  assert.equal(plan.historyRecords.length, 1);
  assert.equal(plan.historyRecords[0].workspaceId, 'target-workspace');
  assert.equal(plan.historyRecords[0].event.action, 'workspace-contents-replaced');
  assert.match(plan.historyRecords[0].event.summary, /Source Workspace/);
  assert.equal(plan.metadata.sourceWorkspaceId, 'source-workspace');
  assert.equal(plan.metadata.targetWorkspaceId, 'target-workspace');
});

test('workspace contents cannot overwrite the source itself or an archived workspace', () => {
  const library = fixtureLibrary();
  assert.throws(
    () => replaceWorkspaceContents(library, 'source-workspace', 'source-workspace'),
    /different workspace/i
  );

  const archived = clone(library);
  archived.workspaces.find(record => record.id === 'target-workspace').archived = true;
  assert.throws(
    () => replaceWorkspaceContents(archived, 'source-workspace', 'target-workspace'),
    /archived target/i
  );
});


test('copy destinations exclude source and archived workspaces and disambiguate duplicate names', () => {
  const library = fixtureLibrary();
  library.workspaces[1].profile.profile.name = 'Shared';
  library.workspaces[2].profile.profile.name = 'Shared';
  library.workspaces[2].archived = true;

  const destinations = workspaceContentsCopyDestinations(library, 'source-workspace');
  assert.deepEqual(destinations, [{
    id: 'target-workspace',
    name: 'Shared',
    displayName: 'Shared',
  }]);

  library.workspaces[2].archived = false;
  assert.deepEqual(
    workspaceContentsCopyDestinations(library, 'source-workspace').map(item => item.displayName),
    ['Shared · target-workspace', 'Shared · untouched-workspace']
  );
});

async function loadProfileStoreForNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const source = fs.readFileSync(path.join(root, 'src/services/profile-store.js'), 'utf8');
  const bodyStart = source.indexOf('const DIRECTORY_NAME');
  assert.notEqual(bodyStart, -1);
  const planModule = pathToFileURL(path.join(root, 'src/services/workspace-contents-copy.js')).href;
  const transformed = `
import {buildWorkspaceContentsCopyPlan} from '${planModule}';
const Gio = {};
const GLib = {};
const logError = () => {};
${source.slice(bodyStart)}
`
    .replace('export class ProfileStore', 'class ProfileStore')
    .concat('\nexport {ProfileStore};\n');
  return import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
}

test('ProfileStore copyWorkspaceContents uses one queued transaction and preserves history warnings', async () => {
  const {ProfileStore} = await loadProfileStoreForNode();
  const store = Object.create(ProfileStore.prototype);
  store.library = fixtureLibrary();
  let queued = null;
  let plan = null;
  store._enqueueLibraryMutation = async (scope, operation, options) => {
    queued = {scope, options};
    return operation();
  };
  store._runLibraryTransaction = builder => {
    plan = builder(store.library);
    return {...plan, historyWarning: new Error('history unavailable')};
  };
  store.warning = null;

  const result = await store.copyWorkspaceContents('source-workspace', 'target-workspace');
  assert.equal(result.metadata.sourceWorkspaceId, 'source-workspace');
  assert.equal(result.metadata.targetWorkspaceId, 'target-workspace');

  assert.equal(queued.scope, 'workspace-contents-copy');
  assert.equal(queued.options.deduplicationKey, 'workspace-contents-copy:source-workspace:target-workspace');
  assert.equal(plan.restorePoints[0].workspaceId, 'target-workspace');
  assert.match(store.warning, /history could not be fully updated/i);
});

test('persistence failure never publishes a partially overwritten target', () => {
  const library = fixtureLibrary();
  const before = clone(library);
  let published = false;
  let restorePointCreated = false;

  assert.throws(() => executeLibraryTransaction({
    readCurrent: () => ({library, etag: 'etag-before'}),
    buildCandidate: current => buildWorkspaceContentsCopyPlan(current, {
      sourceWorkspaceId: 'source-workspace',
      targetWorkspaceId: 'target-workspace',
    }),
    validateCandidate: () => {},
    createRestorePoint: restore => {
      restorePointCreated = true;
      assert.equal(restore.workspaceId, 'target-workspace');
      return 'restore.json';
    },
    persist: () => { throw new Error('write failed'); },
    publish: () => { published = true; },
    writeHistory: () => { throw new Error('history must not run'); },
  }), /write failed/);

  assert.equal(restorePointCreated, true);
  assert.equal(published, false);
  assert.deepEqual(library, before);
});
