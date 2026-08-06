import {cloneDefaultProfile, createEmptyProfile} from '../src/services/default-profile.js';
import {addWorkspace, createWorkspaceLibrary, workspaceProfile} from '../src/services/workspace-library-contract.js';
import {buildWorkspaceContentsCopyPlan} from '../src/services/workspace-contents-copy.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const source = cloneDefaultProfile();
source.profile.id = 'source-gjs';
source.profile.name = 'Source GJS';
const target = createEmptyProfile();
target.profile.id = 'target-gjs';
target.profile.name = 'Target GJS';
target.profile.organisation = 'Target Organisation';

const library = addWorkspace(createWorkspaceLibrary(source), target);
const plan = buildWorkspaceContentsCopyPlan(library, {
  sourceWorkspaceId: 'source-gjs',
  targetWorkspaceId: 'target-gjs',
});
const copied = workspaceProfile(plan.candidateLibrary, 'target-gjs');

assert(copied.profile.id === 'target-gjs', 'Target workspace ID must remain unchanged');
assert(copied.profile.name === 'Target GJS', 'Target workspace name must remain unchanged');
assert(copied.profile.organisation === 'Target Organisation', 'Target organisation metadata must remain unchanged');
assert(copied.sections.apps.length === source.sections.apps.length, 'Source application contents must be copied');
assert(plan.restorePoints.length === 1, 'Target restore point must be created');
assert(plan.restorePoints[0].workspaceId === 'target-gjs', 'Restore point must belong to target workspace');
