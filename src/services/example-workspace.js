import {cloneDefaultProfile} from './default-profile.js';
import {validateWorkspaceLibrary} from './workspace-library-contract.js';

function normaliseName(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function nextExampleWorkspaceName(library) {
  const validated = validateWorkspaceLibrary(library);
  const existingNames = new Set(
    validated.workspaces.map(record => normaliseName(record.profile.profile.name))
  );

  const baseName = 'Example Workspace';
  if (!existingNames.has(normaliseName(baseName)))
    return baseName;

  let suffix = 2;
  while (existingNames.has(normaliseName(`${baseName} ${suffix}`)))
    suffix += 1;
  return `${baseName} ${suffix}`;
}

export function createExampleWorkspaceProfile(library, {id} = {}) {
  const validated = validateWorkspaceLibrary(library);
  const workspaceId = String(id ?? '').trim();
  if (!workspaceId)
    throw new Error('Example workspace id is required');
  if (validated.workspaces.some(record => record.id === workspaceId))
    throw new Error(`Duplicate workspace id: ${workspaceId}`);

  const profile = cloneDefaultProfile();
  profile.profile.id = workspaceId;
  profile.profile.name = nextExampleWorkspaceName(validated);
  profile.profile.source = 'example';
  profile.settings.setup_completed = true;
  return profile;
}
