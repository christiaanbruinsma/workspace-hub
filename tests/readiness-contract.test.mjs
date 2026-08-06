import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWorkspaceReadiness} from '../src/services/readiness-contract.js';

function profile(overrides = {}) {
  return {
    schema_version: 5,
    profile: {name:'Office Workspace', source:'local', ...overrides.profile},
    settings: {setup_completed:true, ...overrides.settings},
    sections: {apps:[{id:'mail', enabled:true}], web_apps:[], files_places:[], daily_tools:[], help_support:[], ...overrides.sections},
  };
}

function diagnostics(overrides = {}) {
  return {
    browser: {detected:true, name:'Firefox', ...overrides.browser},
    summary: {attention:0, notChecked:0, ...overrides.summary},
  };
}

test('ready workspace passes the beta readiness gate', () => {
  const result = evaluateWorkspaceReadiness(profile(), diagnostics());
  assert.equal(result.status, 'ready');
  assert.equal(result.failed, 0);
  assert.equal(result.warnings, 0);
});

test('example or unfinished setup is incomplete', () => {
  const result = evaluateWorkspaceReadiness(profile({profile:{source:'example'}, settings:{setup_completed:false}}), diagnostics());
  assert.equal(result.status, 'incomplete');
  assert.equal(result.checks.find(check => check.id === 'setup').state, 'fail');
});

test('missing apps or deferred remote checks require review without false failure', () => {
  const result = evaluateWorkspaceReadiness(profile(), diagnostics({summary:{attention:2, notChecked:1}}));
  assert.equal(result.status, 'needs-review');
  assert.equal(result.warnings, 1);
  assert.equal(result.information, 1);
});

test('empty workspace remains incomplete', () => {
  const result = evaluateWorkspaceReadiness(profile({sections:{apps:[]}}), diagnostics());
  assert.equal(result.status, 'incomplete');
});
