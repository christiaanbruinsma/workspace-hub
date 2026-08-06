import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDefaultProfile} from '../src/services/default-profile.js';
import {buildDiagnosticReport, redactDiagnosticTarget, summariseDiagnostics} from '../src/services/diagnostic-contract.js';

const checks = [
  {id:'app', section:'apps', type:'application', title:'App', status:'available', detail:'available', item:{type:'application', desktop_id:'org.example.App.desktop'}},
  {id:'missing', section:'apps', type:'application', title:'Missing', status:'missing', detail:'missing', item:{type:'application', desktop_id:'org.example.Missing.desktop'}},
  {id:'site', section:'web_apps', type:'web', title:'Site', status:'valid', detail:'valid', item:{type:'web', url:'https://example.com/path?token=secret#private'}},
  {id:'mail', section:'help_support', type:'web', title:'Mail', status:'valid', detail:'valid', item:{type:'web', url:'mailto:person@example.com'}},
  {id:'local', section:'files_places', type:'place', title:'Local', status:'available', detail:'exists', item:{type:'place', uri:'/home/alex/Documents'}},
  {id:'remote', section:'files_places', type:'place', title:'Remote', status:'not-checked', detail:'deferred', item:{type:'place', uri:'smb://server/company'}},
];

test('diagnostic summary separates attention from intentionally deferred checks', () => {
  const summary = summariseDiagnostics(checks);
  assert.equal(summary.attention, 1);
  assert.equal(summary.notChecked, 1);
  assert.equal(summary.configured, 2);
  assert.deepEqual(summary.applications, {total:2, available:1, missing:1});
  assert.equal(summary.places.remoteConfigured, 1);
});

test('diagnostic targets remove URL secrets, mail addresses and personal home paths', () => {
  assert.equal(redactDiagnosticTarget(checks[2].item), 'https://example.com/path');
  assert.equal(redactDiagnosticTarget(checks[3].item), 'mailto:[redacted]');
  assert.equal(redactDiagnosticTarget(checks[4].item, '/home/alex'), '~/Documents');
  assert.equal(redactDiagnosticTarget({type:'place', uri:'file:///home/alex/Private'}, '/home/alex'), 'file://~/Private');
});

test('diagnostic report exposes governance metadata and explicit privacy guarantees', () => {
  const report = buildDiagnosticReport({
    profile: cloneDefaultProfile(), checks, appVersion:'0.9.0', generatedAt:'2026-08-02T00:00:00+0200',
    platform:{name:'Zorin OS', version:'18'}, homeDirectory:'/home/alex',
  });
  assert.equal(report.format, 'workspace-hub-diagnostic-report');
  assert.equal(report.application.version, '0.9.0');
  assert.deepEqual(report.application, {name:'Workspace Hub', version:'0.9.0'});
  assert.equal(report.privacy.includes_passwords, false);
  assert.equal(report.privacy.includes_tokens, false);
  assert.equal(report.checks.find(item => item.id === 'site').target.includes('secret'), false);
  assert.equal(report.checks.find(item => item.id === 'mail').target, 'mailto:[redacted]');
});


test('manual remote results distinguish reachable and unavailable locations', () => {
  const extended = [
    ...checks,
    {id:'remote-ok', section:'files_places', type:'place', title:'Remote OK', status:'remote-available', detail:'manual', checkedAt:'now', manual:true, item:{type:'place', uri:'smb://server/ok'}},
    {id:'remote-bad', section:'files_places', type:'place', title:'Remote bad', status:'remote-unavailable', detail:'manual', checkedAt:'now', manual:true, item:{type:'place', uri:'smb://server/bad'}},
  ];
  const summary = summariseDiagnostics(extended);
  assert.equal(summary.places.remoteAvailable, 1);
  assert.equal(summary.places.remoteUnavailable, 1);
  assert.equal(summary.attention, 2);
});
