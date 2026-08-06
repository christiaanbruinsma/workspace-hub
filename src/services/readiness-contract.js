export const READINESS_STATES = Object.freeze({
  READY: 'ready',
  REVIEW: 'needs-review',
  INCOMPLETE: 'incomplete',
});

function enabledItems(profile) {
  return Object.values(profile.sections ?? {})
    .flat()
    .filter(item => item.enabled !== false);
}

export function evaluateWorkspaceReadiness(profile, diagnostics) {
  const items = enabledItems(profile);
  const checks = [];

  const setupComplete = profile.settings?.setup_completed === true && profile.profile?.source !== 'example';
  checks.push({
    id: 'setup',
    title: 'Workspace setup',
    state: setupComplete ? 'pass' : 'fail',
    detail: setupComplete ? 'The guided setup has been completed.' : 'Complete setup and replace the example workspace before deployment.',
  });

  const hasContent = items.length > 0;
  checks.push({
    id: 'content',
    title: 'Workspace content',
    state: hasContent ? 'pass' : 'fail',
    detail: hasContent ? `${items.length} enabled workspace items are configured.` : 'Add at least one application, website, place or support action.',
  });

  const identityComplete = Boolean(profile.profile?.name?.trim()) && profile.profile.name !== 'Example Workspace';
  checks.push({
    id: 'identity',
    title: 'Workspace identity',
    state: identityComplete ? 'pass' : 'warning',
    detail: identityComplete ? `Profile ${profile.profile.name} is identified.` : 'Give the workspace a recognisable non-example name.',
  });

  const browserDetected = diagnostics?.browser?.detected === true;
  checks.push({
    id: 'browser',
    title: 'Default browser',
    state: browserDetected ? 'pass' : 'warning',
    detail: browserDetected ? `${diagnostics.browser.name} is available as the default browser.` : 'No default browser could be detected.',
  });

  const attention = Number(diagnostics?.summary?.attention ?? 0);
  checks.push({
    id: 'health',
    title: 'Local availability',
    state: attention === 0 ? 'pass' : 'warning',
    detail: attention === 0 ? 'No locally detected item needs attention.' : `${attention} configured item${attention === 1 ? '' : 's'} need attention.`,
  });

  const notChecked = Number(diagnostics?.summary?.notChecked ?? 0);
  checks.push({
    id: 'remote',
    title: 'Deferred checks',
    state: notChecked === 0 ? 'pass' : 'info',
    detail: notChecked === 0 ? 'No configured item is waiting for an explicit check.' : `${notChecked} remote item${notChecked === 1 ? '' : 's'} remain intentionally not checked.`,
  });

  const failed = checks.filter(check => check.state === 'fail').length;
  const warnings = checks.filter(check => check.state === 'warning').length;
  const information = checks.filter(check => check.state === 'info').length;
  const status = failed > 0 ? READINESS_STATES.INCOMPLETE : (warnings > 0 || information > 0 ? READINESS_STATES.REVIEW : READINESS_STATES.READY);

  return {
    status,
    label: status === READINESS_STATES.READY ? 'Ready for daily use' : status === READINESS_STATES.REVIEW ? 'Needs review' : 'Setup incomplete',
    summary: status === READINESS_STATES.READY
      ? 'The configured workspace passed the current beta readiness checks.'
      : status === READINESS_STATES.REVIEW
        ? 'The workspace can be used, but one or more items should be reviewed.'
        : 'Finish the initial workspace setup before treating this profile as deployed.',
    failed,
    warnings,
    information,
    checks,
  };
}
