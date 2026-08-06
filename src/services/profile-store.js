import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {cloneDefaultProfile, createEmptyProfile} from './default-profile.js';
import {createExampleWorkspaceProfile} from './example-workspace.js';
import {normaliseProfile, serializeProfile, validateProfile} from './profile-contract.js';
import {
  activeWorkspaceProfile,
  addWorkspace,
  createWorkspaceLibrary,
  duplicateWorkspace as duplicateWorkspaceRecord,
  moveWorkspace as moveWorkspaceRecord,
  normaliseWorkspaceLibrary,
  removeWorkspace as removeWorkspaceRecord,
  renameWorkspace as renameWorkspaceRecord,
  replaceActiveWorkspace,
  serializeWorkspaceLibrary,
  setActiveWorkspace,
  setWorkspaceArchived,
  updateApplicationSettings,
  workspaceLibrarySummary,
  validateWorkspaceLibrary,
  workspaceProfile,
} from './workspace-library-contract.js';
import {createHistoryRecord, historyForWorkspace} from './governance-contract.js';
import {executeLibraryTransaction} from './library-transaction.js';
import {LibraryMutationQueue} from './library-mutation-queue.js';
import {mergeProfileUpdate} from './profile-three-way-merge.js';
import {buildWorkspaceItemTransferPlan, workspaceTransferDestinations} from './workspace-item-transfer.js';
import {buildWorkspaceContentsCopyPlan, workspaceContentsCopyDestinations} from './workspace-contents-copy.js';

const DIRECTORY_NAME = 'workspace-hub';
const LIBRARY_FILE = 'workspace-library.json';
const LEGACY_PROFILE_FILE = 'workspace-profile.json';
const HISTORY_FILE = 'workspace-history.json';
const RESTORE_DIRECTORY = 'restore-points';
const DELETED_WORKSPACE_DIRECTORY = 'deleted-workspaces';
const HISTORY_LIMIT = 200;
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 10 * 1024 * 1024;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;

class WorkspaceDataReadError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'WorkspaceDataReadError';
    this.cause = cause;
  }
}

function decode(contents) {
  return new TextDecoder().decode(contents);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeViewStateUpdate(baselineProfile, desiredProfile, latestProfile) {
  const mergedProfile = clone(latestProfile);
  const baselineSections = baselineProfile.settings?.section_tabs ?? {};
  const desiredSections = desiredProfile.settings?.section_tabs ?? {};
  const latestSections = mergedProfile.settings?.section_tabs ?? {};

  for (const [sectionName, desiredState] of Object.entries(desiredSections)) {
    const desiredTabId = desiredState?.active_tab_id;
    const baselineTabId = baselineSections[sectionName]?.active_tab_id;
    if (desiredTabId === baselineTabId)
      continue;

    const latestState = latestSections[sectionName];
    if (!latestState?.tabs?.some(tab => tab.id === desiredTabId))
      throw new Error('The selected tab is no longer available');
    latestState.active_tab_id = desiredTabId;
  }

  return mergedProfile;
}

function safeTimestamp() {
  return GLib.DateTime.new_now_utc().format('%Y%m%dT%H%M%SZ');
}

export class ProfileStore {
  constructor() {
    this.directoryPath = GLib.build_filenamev([GLib.get_user_config_dir(), DIRECTORY_NAME]);
    this.libraryPath = GLib.build_filenamev([this.directoryPath, LIBRARY_FILE]);
    this.legacyProfilePath = GLib.build_filenamev([this.directoryPath, LEGACY_PROFILE_FILE]);
    // Compatibility alias for existing diagnostics and integrations. The active
    // workspace is now stored inside the workspace library.
    this.profilePath = this.libraryPath;
    this.historyPath = GLib.build_filenamev([this.directoryPath, HISTORY_FILE]);
    this.restoreDirectoryPath = GLib.build_filenamev([this.directoryPath, RESTORE_DIRECTORY]);
    this.deletedWorkspaceDirectoryPath = GLib.build_filenamev([this.directoryPath, DELETED_WORKSPACE_DIRECTORY]);
    this.warning = null;
    this._persistenceBlockedReason = null;
    this._libraryMutationQueue = new LibraryMutationQueue();
    this._mutationSequence = 0;
    this._pendingViewStates = new Map();
    this._viewStateSavePromises = new Map();
    this._ensureDirectory();
    this.library = this._loadOrCreateLibrary();
    this._syncState();
  }

  _ensureDirectory() {
    GLib.mkdir_with_parents(this.directoryPath, 0o700);
    GLib.mkdir_with_parents(this.restoreDirectoryPath, 0o700);
    GLib.mkdir_with_parents(this.deletedWorkspaceDirectoryPath, 0o700);
  }

  _loadContents(file, message = 'Workspace data could not be read') {
    let result;
    try {
      result = file.load_contents(null);
    } catch (error) {
      throw new WorkspaceDataReadError(message, error);
    }
    if (!Array.isArray(result) || result[0] !== true || result[1] === null || result[1] === undefined)
      throw new WorkspaceDataReadError(message);
    return {contents: result[1], etag: result[2] ?? null};
  }

  _readJson(file, maximumBytes, sizeMessage) {
    const {contents} = this._loadContents(file);
    if (contents.length > maximumBytes)
      throw new Error(sizeMessage);
    return JSON.parse(decode(contents));
  }

  _fallbackLibrary() {
    return createWorkspaceLibrary(cloneDefaultProfile(), {language: 'system'});
  }

  _blockPersistence(message) {
    this._persistenceBlockedReason = message;
    this.warning = message;
  }

  _recoverInvalidLibrary(libraryFile, error) {
    logError(error, 'Unable to load Workspace Hub workspace library');
    const fallback = this._fallbackLibrary();
    let preservedPath;
    try {
      preservedPath = this._preserveInvalidFile(libraryFile, this.libraryPath);
    } catch (preservationError) {
      logError(preservationError, 'Unable to preserve invalid Workspace Hub data');
      this._blockPersistence(
        'The workspace library is invalid and could not be preserved safely. '
        + 'The original file is untouched and changes are disabled.'
      );
      return fallback;
    }

    try {
      this._writeLibrary(libraryFile, fallback);
    } catch (writeError) {
      logError(writeError, 'Unable to write recovered Workspace Hub workspace library');
      this._blockPersistence(
        `A recovery copy was created at ${preservedPath}, but a new workspace library could not be written. `
        + 'The original file is untouched and changes are disabled.'
      );
      return fallback;
    }

    this.warning = `The previous workspace library was invalid. A recovery copy was created at ${preservedPath}.`;
    return fallback;
  }

  _loadOrCreateLibrary() {
    const libraryFile = Gio.File.new_for_path(this.libraryPath);
    if (libraryFile.query_exists(null)) {
      let rawLibrary;
      try {
        rawLibrary = this._readJson(
          libraryFile,
          MAX_LIBRARY_BYTES,
          'Workspace library is larger than the supported 10 MiB limit'
        );
      } catch (error) {
        if (error instanceof WorkspaceDataReadError) {
          logError(error, 'Unable to read Workspace Hub workspace library');
          this._blockPersistence(
            'The workspace library could not be read. The original file is untouched and changes are disabled.'
          );
          return this._fallbackLibrary();
        }
        return this._recoverInvalidLibrary(libraryFile, error);
      }

      let library;
      try {
        library = normaliseWorkspaceLibrary(rawLibrary);
      } catch (error) {
        return this._recoverInvalidLibrary(libraryFile, error);
      }

      try {
        this._writeLibrary(libraryFile, library);
      } catch (error) {
        logError(error, 'Unable to persist normalised Workspace Hub workspace library');
        this._blockPersistence(
          'Workspace data was loaded, but changes are disabled because the workspace library could not be written.'
        );
      }
      return library;
    }

    const migrated = this._migrateLegacyProfile();
    if (migrated) {
      if (!this._persistenceBlockedReason) {
        try {
          this._writeLibrary(libraryFile, migrated);
        } catch (error) {
          logError(error, 'Unable to write migrated Workspace Hub workspace library');
          this._blockPersistence(
            'The previous workspace was loaded, but changes are disabled because the workspace library could not be written.'
          );
        }
      }
      return migrated;
    }

    const library = this._fallbackLibrary();
    if (this._persistenceBlockedReason)
      return library;
    try {
      this._writeLibrary(libraryFile, library);
    } catch (error) {
      logError(error, 'Unable to create Workspace Hub workspace library');
      this._blockPersistence(
        'A new workspace could not be saved. Changes are disabled until the workspace storage is writable.'
      );
    }
    return library;
  }

  _migrateLegacyProfile() {
    const legacyFile = Gio.File.new_for_path(this.legacyProfilePath);
    if (!legacyFile.query_exists(null))
      return null;

    let rawProfile;
    try {
      rawProfile = this._readJson(
        legacyFile,
        MAX_PROFILE_BYTES,
        'Workspace profile is larger than the supported 2 MiB limit'
      );
    } catch (error) {
      if (error instanceof WorkspaceDataReadError) {
        logError(error, 'Unable to read legacy Workspace Hub profile');
        this._blockPersistence(
          'The previous workspace profile could not be read. The original file is untouched and changes are disabled.'
        );
        return null;
      }
      return this._recoverInvalidLegacyProfile(legacyFile, error);
    }

    try {
      return normaliseWorkspaceLibrary(rawProfile);
    } catch (error) {
      return this._recoverInvalidLegacyProfile(legacyFile, error);
    }
  }

  _recoverInvalidLegacyProfile(legacyFile, error) {
    logError(error, 'Unable to migrate legacy Workspace Hub profile');
    try {
      const preservedPath = this._preserveInvalidFile(legacyFile, this.legacyProfilePath);
      this.warning = `The previous workspace profile was invalid. A recovery copy was created at ${preservedPath}.`;
    } catch (preservationError) {
      logError(preservationError, 'Unable to preserve invalid legacy Workspace Hub profile');
      this._blockPersistence(
        'The previous workspace profile is invalid and could not be preserved safely. '
        + 'The original file is untouched and changes are disabled.'
      );
    }
    return null;
  }

  _preserveInvalidFile(file, originalPath) {
    const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
    const preservedPath = `${originalPath}.invalid-${stamp}-${GLib.uuid_string_random()}.json`;
    const destination = Gio.File.new_for_path(preservedPath);
    const copied = file.copy(destination, Gio.FileCopyFlags.NONE, null, null);
    if (copied === false || !destination.query_exists(null))
      throw new Error('Workspace data recovery copy could not be verified');
    return preservedPath;
  }

  _syncState() {
    this.profile = activeWorkspaceProfile(this.library);
    this.applicationSettings = clone(this.library.application_settings);
  }

  _replaceContents(file, bytes, expectedEtag = null) {
    const result = file.replace_contents(
      bytes,
      expectedEtag,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null
    );
    if (!Array.isArray(result) || result[0] !== true)
      throw new Error('Workspace data write could not be confirmed');
    return result[1] ?? null;
  }

  _writeProfile(file, profile) {
    const bytes = new TextEncoder().encode(serializeProfile(profile));
    this._replaceContents(file, bytes);
  }

  _writeLibrary(file, library, expectedEtag = null) {
    const bytes = new TextEncoder().encode(serializeWorkspaceLibrary(library));
    return this._replaceContents(file, bytes, expectedEtag);
  }

  _readCurrentLibraryState() {
    const file = Gio.File.new_for_path(this.libraryPath);
    const {contents, etag} = this._loadContents(file, 'Workspace library could not be read');
    if (contents.length > MAX_LIBRARY_BYTES)
      throw new Error('Workspace library is larger than the supported 10 MiB limit');
    return {
      library: normaliseWorkspaceLibrary(JSON.parse(decode(contents))),
      etag,
    };
  }

  _readHistory() {
    const file = Gio.File.new_for_path(this.historyPath);
    if (!file.query_exists(null))
      return [];
    try {
      const {contents} = this._loadContents(file, 'Workspace history could not be read');
      if (contents.length > MAX_HISTORY_BYTES)
        throw new Error('Workspace history is larger than the supported limit');
      const parsed = JSON.parse(decode(contents));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logError(error, 'Unable to read Workspace Hub history');
      return [];
    }
  }

  _writeHistory(history) {
    const file = Gio.File.new_for_path(this.historyPath);
    const bytes = new TextEncoder().encode(`${JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2)}\n`);
    this._replaceContents(file, bytes);
  }

  _createRestorePoint(profile) {
    if (!profile)
      return null;
    const name = `${safeTimestamp()}-${GLib.uuid_string_random()}.json`;
    const path = GLib.build_filenamev([this.restoreDirectoryPath, name]);
    this._writeProfile(Gio.File.new_for_path(path), profile);
    return name;
  }

  _historyRecord(event, profile, restoreFile) {
    const timestamp = event.timestamp ?? GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S%z');
    return createHistoryRecord({
      action: event.action ?? 'workspace-updated',
      summary: event.summary ?? 'Workspace configuration updated',
      profile,
      timestamp,
      restoreFile,
      details: {
        workspace_id: profile.profile.id,
        ...(event.details ?? {}),
      },
    });
  }

  _writeHistoryRecords(records, restoreFiles) {
    if (!Array.isArray(records) || records.length === 0)
      return;
    const restoreByWorkspace = new Map(
      restoreFiles.map(record => [record.workspaceId, record.restoreFile])
    );
    const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S%z');
    const created = records.map(record => this._historyRecord(
      {...record.event, timestamp},
      record.profile,
      restoreByWorkspace.get(record.workspaceId) ?? null
    ));
    const history = this._readHistory();
    history.unshift(...created);
    this._writeHistory(history);
  }

  _nextMutationKey(scope) {
    this._mutationSequence += 1;
    return `${scope}:${this._mutationSequence}`;
  }

  _enqueueLibraryMutation(scope, operation, {deduplicationKey = null} = {}) {
    if (this._persistenceBlockedReason)
      return Promise.reject(new Error(this._persistenceBlockedReason));

    const key = deduplicationKey ?? this._nextMutationKey(scope);
    return this._libraryMutationQueue.enqueue(key, operation);
  }

  _runLibraryTransaction(buildCandidate, currentState = null) {
    let persistedEtag = null;
    return executeLibraryTransaction({
      readCurrent: () => currentState ?? this._readCurrentLibraryState(),
      buildCandidate,
      validateCandidate: candidateLibrary => validateWorkspaceLibrary(candidateLibrary),
      createRestorePoint: restore => this._createRestorePoint(restore.profile),
      persist: (candidateLibrary, expectedEtag) => {
        persistedEtag = this._writeLibrary(
          Gio.File.new_for_path(this.libraryPath),
          candidateLibrary,
          expectedEtag
        );
      },
      publish: candidateLibrary => {
        this.library = candidateLibrary;
        this._libraryEtag = persistedEtag;
        this._syncState();
      },
      writeHistory: (records, restoreFiles) => this._writeHistoryRecords(records, restoreFiles),
    });
  }

  save(profile, event = {}, applicationSettings = null) {
    const profileSnapshot = clone(profile);
    const eventSnapshot = clone(event);
    const applicationSettingsSnapshot = applicationSettings ? clone(applicationSettings) : null;
    validateProfile(profileSnapshot);
    const expectedWorkspaceId = this.library.active_workspace_id;
    const baselineProfile = clone(this.profile);

    return this._enqueueLibraryMutation('save', () => {
      const result = this._runLibraryTransaction(currentLibrary => {
        if (currentLibrary.active_workspace_id !== expectedWorkspaceId)
          throw new Error('The active workspace changed before this update could be saved');
        const previousProfile = activeWorkspaceProfile(currentLibrary);
        const mergedProfile = mergeProfileUpdate(baselineProfile, profileSnapshot, previousProfile);
        validateProfile(mergedProfile);
        let candidateLibrary = replaceActiveWorkspace(currentLibrary, mergedProfile);
        if (applicationSettingsSnapshot)
          candidateLibrary = updateApplicationSettings(candidateLibrary, applicationSettingsSnapshot);
        return {
          candidateLibrary,
          restorePoints: [{workspaceId: previousProfile.profile.id, profile: previousProfile}],
          historyRecords: [{
            workspaceId: mergedProfile.profile.id,
            profile: mergedProfile,
            event: eventSnapshot,
          }],
        };
      });
      if (result.historyWarning) {
        logError(result.historyWarning, 'Workspace was saved but its history entry could not be recorded');
        this.warning = 'Workspace history could not be updated. The workspace itself was saved.';
      }
      return result;
    });
  }

  _commitPendingViewState(workspaceId) {
    return this._enqueueLibraryMutation('view-state', () => {
      const pendingViewState = this._pendingViewStates.get(workspaceId);
      this._pendingViewStates.delete(workspaceId);
      if (!pendingViewState)
        return this.profile;

      const currentState = this._readCurrentLibraryState();
      if (currentState.library.active_workspace_id !== workspaceId)
        return this.profile;

      this._runLibraryTransaction(currentLibrary => {
        const latestProfile = activeWorkspaceProfile(currentLibrary);
        const mergedProfile = mergeViewStateUpdate(
          pendingViewState.baseline,
          pendingViewState.desired,
          latestProfile
        );
        validateProfile(mergedProfile);
        return {
          candidateLibrary: replaceActiveWorkspace(currentLibrary, mergedProfile),
          restorePoints: [],
          historyRecords: [],
        };
      }, currentState);
      return this.profile;
    }, {deduplicationKey: `view-state:${workspaceId}`});
  }

  async _drainPendingViewStates(workspaceId) {
    let savedProfile = this.profile;
    while (this._pendingViewStates.has(workspaceId))
      savedProfile = await this._commitPendingViewState(workspaceId);
    return savedProfile;
  }

  saveViewState(profile) {
    const profileSnapshot = clone(profile);
    validateProfile(profileSnapshot);
    if (this._persistenceBlockedReason)
      return Promise.reject(new Error(this._persistenceBlockedReason));

    const workspaceId = profileSnapshot.profile.id;
    this._pendingViewStates.set(workspaceId, {
      baseline: clone(this.profile),
      desired: profileSnapshot,
    });

    const activeSave = this._viewStateSavePromises.get(workspaceId);
    if (activeSave)
      return activeSave;

    const drainPromise = this._drainPendingViewStates(workspaceId);
    this._viewStateSavePromises.set(workspaceId, drainPromise);
    const release = () => {
      if (this._viewStateSavePromises.get(workspaceId) === drainPromise)
        this._viewStateSavePromises.delete(workspaceId);
    };
    drainPromise.then(release, release);
    return drainPromise;
  }

  loadExternal(file) {
    const raw = this._readJson(
      file,
      MAX_PROFILE_BYTES,
      'Workspace profile is larger than the supported 2 MiB limit'
    );
    return normaliseProfile(raw);
  }

  importProfile(profile) {
    const imported = normaliseProfile(clone(profile));
    imported.profile.source = 'imported';
    imported.settings.setup_completed = true;
    validateProfile(imported);

    return this._enqueueLibraryMutation('import-profile', () => {
      const currentState = this._readCurrentLibraryState();
      const previousProfile = activeWorkspaceProfile(currentState.library);
      const result = this._runLibraryTransaction(currentLibrary => ({
        candidateLibrary: replaceActiveWorkspace(currentLibrary, imported),
        restorePoints: [{workspaceId: imported.profile.id, profile: previousProfile}],
        historyRecords: [{
          workspaceId: imported.profile.id,
          profile: imported,
          event: {
            action: 'workspace-imported',
            summary: `Imported ${imported.profile.name}`,
            details: {profile_id: imported.profile.id, revision: imported.profile.revision ?? ''},
          },
        }],
      }), currentState);
      if (result.historyWarning) {
        logError(result.historyWarning, 'Workspace was imported but its history entry could not be recorded');
        this.warning = 'Workspace history could not be updated. The imported workspace itself was saved.';
      }
      return result;
    });
  }

  exportProfile(file) {
    this._writeProfile(file, this.profile);
  }

  listWorkspaces() {
    return workspaceLibrarySummary(this.library).workspaces;
  }

  getWorkspaceLibrarySummary() {
    return workspaceLibrarySummary(this.library);
  }

  _commitLibrary(scope, mutate, {deduplicationKey = null} = {}) {
    return this._enqueueLibraryMutation(scope, () => {
      this._runLibraryTransaction(currentLibrary => ({
        candidateLibrary: mutate(currentLibrary),
        restorePoints: [],
        historyRecords: [],
      }));
      return this.profile;
    }, {deduplicationKey});
  }

  _newWorkspaceId() {
    return `workspace-${GLib.uuid_string_random()}`;
  }

  addWorkspace(profile, {activate = false} = {}) {
    const profileSnapshot = clone(profile);
    validateProfile(profileSnapshot);
    return this._commitLibrary('workspace-add', library => addWorkspace(library, profileSnapshot, {activate}));
  }

  createWorkspace(name, {activate = true} = {}) {
    const profile = createEmptyProfile();
    profile.profile.id = this._newWorkspaceId();
    profile.profile.name = String(name ?? '').trim();
    profile.profile.source = 'local';
    profile.settings.icon_style = this.profile.settings.icon_style;
    profile.settings.application_icon_policy = this.profile.settings.application_icon_policy;
    validateProfile(profile);
    return this._commitLibrary('workspace-create', library => addWorkspace(library, profile, {activate}));
  }

  createExampleWorkspace({activate = true} = {}) {
    const workspaceId = this._newWorkspaceId();
    return this._commitLibrary('workspace-create-example', library => {
      const profile = createExampleWorkspaceProfile(library, {id: workspaceId});
      return addWorkspace(library, profile, {activate});
    });
  }

  activateWorkspace(workspaceId) {
    return this._commitLibrary(
      'workspace-activate',
      library => setActiveWorkspace(library, workspaceId),
      {deduplicationKey: `workspace-activate:${workspaceId}`}
    );
  }

  renameWorkspace(workspaceId, name) {
    return this._commitLibrary('workspace-rename', library => renameWorkspaceRecord(library, workspaceId, name));
  }

  duplicateWorkspace(workspaceId, name, {activate = true} = {}) {
    const duplicateId = this._newWorkspaceId();
    return this._commitLibrary('workspace-duplicate', library => duplicateWorkspaceRecord(library, workspaceId, {
      id: duplicateId,
      name,
      activate,
    }));
  }

  getWorkspaceContentsCopyDestinations(sourceWorkspaceId) {
    return workspaceContentsCopyDestinations(this.library, sourceWorkspaceId);
  }

  copyWorkspaceContents(sourceWorkspaceId, targetWorkspaceId) {
    const key = `${sourceWorkspaceId}:${targetWorkspaceId}`;
    return this._enqueueLibraryMutation('workspace-contents-copy', () => {
      const transaction = this._runLibraryTransaction(currentLibrary =>
        buildWorkspaceContentsCopyPlan(currentLibrary, {
          sourceWorkspaceId,
          targetWorkspaceId,
        })
      );
      if (transaction.historyWarning) {
        logError(transaction.historyWarning, 'Workspace contents were copied but history could not be updated');
        this.warning = 'The workspace contents were copied, but workspace history could not be fully updated.';
      }
      return transaction;
    }, {deduplicationKey: `workspace-contents-copy:${key}`});
  }

  setWorkspaceArchived(workspaceId, archived) {
    return this._commitLibrary('workspace-archive', library => setWorkspaceArchived(library, workspaceId, archived));
  }

  moveWorkspace(workspaceId, direction) {
    return this._commitLibrary('workspace-reorder', library => moveWorkspaceRecord(library, workspaceId, direction));
  }

  removeWorkspace(workspaceId) {
    return this._enqueueLibraryMutation('workspace-remove', () => {
      const currentState = this._readCurrentLibraryState();
      const removedProfile = workspaceProfile(currentState.library, workspaceId);
      const backupName = `${safeTimestamp()}-${GLib.uuid_string_random()}.json`;
      const backupPath = GLib.build_filenamev([this.deletedWorkspaceDirectoryPath, backupName]);
      this._writeProfile(Gio.File.new_for_path(backupPath), removedProfile);
      try {
        this._runLibraryTransaction(currentLibrary => ({
          candidateLibrary: removeWorkspaceRecord(currentLibrary, workspaceId),
          restorePoints: [],
          historyRecords: [],
        }), currentState);
        return this.profile;
      } catch (error) {
        try {
          Gio.File.new_for_path(backupPath).delete(null);
        } catch (cleanupError) {
          logError(cleanupError, 'Unable to clean up unused deleted workspace backup');
        }
        throw error;
      }
    });
  }

  getWorkspaceTransferDestinations(sourceWorkspaceId, sectionName) {
    return workspaceTransferDestinations(this.library, sourceWorkspaceId, sectionName);
  }

  transferWorkspaceItem(request) {
    const key = [
      request.mode,
      request.sourceWorkspaceId,
      request.destinationWorkspaceId,
      request.sectionName,
      request.sourceItemId,
      request.destinationTabId ?? '',
    ].join(':');

    return this._enqueueLibraryMutation('workspace-item-transfer', () => {
      const transaction = this._runLibraryTransaction(currentLibrary =>
        buildWorkspaceItemTransferPlan(currentLibrary, request)
      );
      if (transaction.historyWarning) {
        logError(transaction.historyWarning, 'Workspace item transfer committed but history could not be updated');
        this.warning = 'The item transfer completed, but workspace history could not be fully updated.';
      }
      return transaction;
    }, {deduplicationKey: `transfer:${key}`});
  }

  _historyForWorkspace(workspaceId = this.profile.profile.id) {
    return historyForWorkspace(this._readHistory(), workspaceId, {
      includeLegacy: this.library.workspaces.length === 1,
    });
  }

  getHistory(workspaceId = this.profile.profile.id) {
    return this._historyForWorkspace(workspaceId);
  }

  getRestorePoints(workspaceId = this.profile.profile.id) {
    return this._historyForWorkspace(workspaceId).filter(record => {
      if (!record.restore_file)
        return false;
      return Gio.File.new_for_path(GLib.build_filenamev([this.restoreDirectoryPath, record.restore_file])).query_exists(null);
    });
  }

  async restoreRevision(restoreFile) {
    if (typeof restoreFile !== 'string' || !/^[0-9]{8}T[0-9]{6}Z-[0-9a-f-]+\.json$/i.test(restoreFile))
      throw new Error('The restore point identifier is invalid');
    const belongsToActiveWorkspace = this.getRestorePoints()
      .some(record => record.restore_file === restoreFile);
    if (!belongsToActiveWorkspace)
      throw new Error('The selected restore point does not belong to the active workspace');
    const file = Gio.File.new_for_path(GLib.build_filenamev([this.restoreDirectoryPath, restoreFile]));
    if (!file.query_exists(null))
      throw new Error('The selected restore point is no longer available');
    const restored = this.loadExternal(file);
    await this.save(restored, {
      action: 'workspace-restored',
      summary: `Restored ${restored.profile.name}`,
      details: {restore_file: restoreFile},
    });
    return this.profile;
  }
}
