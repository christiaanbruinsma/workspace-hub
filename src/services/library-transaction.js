/**
 * Execute one complete library mutation with strict pre-commit restore points,
 * one persistence boundary, publish-after-persist semantics and post-commit
 * history recording.
 */
export function executeLibraryTransaction({
  readCurrent,
  buildCandidate,
  validateCandidate,
  createRestorePoint,
  persist,
  publish,
  writeHistory,
}) {
  const current = readCurrent();
  const plan = buildCandidate(current.library);
  validateCandidate(plan.candidateLibrary);

  const restoreFiles = [];
  for (const restore of plan.restorePoints ?? []) {
    const restoreFile = createRestorePoint(restore);
    restoreFiles.push({...restore, restoreFile});
  }

  persist(plan.candidateLibrary, current.etag);
  publish(plan.candidateLibrary);

  let historyWarning = null;
  try {
    writeHistory?.(plan.historyRecords ?? [], restoreFiles);
  } catch (error) {
    historyWarning = error;
  }

  return {
    status: historyWarning ? 'committed-with-history-warning' : 'committed',
    committed: true,
    historyWarning,
    restoreFiles,
    metadata: plan.metadata ?? {},
  };
}
