const MODES = new Set(['copy', 'move']);

function visibleSection(currentPage, sectionName) {
  return currentPage === 'overview' || currentPage === sectionName;
}

export function buildTransferViewRefreshPlan({
  mode,
  activeWorkspaceId,
  sourceWorkspaceId,
  destinationWorkspaceId,
  sectionName,
  sourceTabId = null,
  destinationTabId = null,
  currentPage,
}) {
  if (!MODES.has(mode))
    throw new Error(`Unsupported transfer mode: ${mode}`);
  if (!visibleSection(currentPage, sectionName))
    return Object.freeze({kind: 'none'});

  if (mode === 'move' && activeWorkspaceId === sourceWorkspaceId) {
    return Object.freeze({
      kind: 'source',
      workspaceId: sourceWorkspaceId,
      pageId: currentPage,
      sectionName,
      tabId: sourceTabId,
    });
  }

  if (activeWorkspaceId === destinationWorkspaceId) {
    return Object.freeze({
      kind: 'destination',
      workspaceId: destinationWorkspaceId,
      pageId: currentPage,
      sectionName,
      tabId: destinationTabId,
    });
  }

  return Object.freeze({kind: 'none'});
}
