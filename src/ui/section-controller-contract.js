function requiredString(value, label) {
  const normalised = String(value ?? '').trim();
  if (!normalised)
    throw new Error(`${label} is required`);
  return normalised;
}

export function createSectionControllerIdentity({workspaceId, pageId, sectionName, generation}) {
  if (!Number.isInteger(generation) || generation < 1)
    throw new Error('Controller generation must be a positive integer');
  return Object.freeze({
    workspaceId: requiredString(workspaceId, 'Workspace id'),
    pageId: requiredString(pageId, 'Page id'),
    sectionName: requiredString(sectionName, 'Section name'),
    generation,
  });
}

export function disposeSectionController(controller) {
  if (controller)
    controller.isDisposed = true;
}

export function sectionControllerMatches(controller, expected) {
  if (!controller || controller.isDisposed)
    return false;
  if (!expected || !Number.isInteger(expected.generation))
    return false;
  return controller.workspaceId === expected.workspaceId
    && controller.pageId === expected.pageId
    && controller.sectionName === expected.sectionName
    && controller.generation === expected.generation;
}
