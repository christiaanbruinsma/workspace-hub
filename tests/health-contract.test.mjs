import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const availability = readFileSync(new URL('../src/services/availability-service.js', import.meta.url), 'utf8');
const cache = readFileSync(new URL('../src/services/health-store.js', import.meta.url), 'utf8');

test('health cache is local and target-bound', () => {
  assert.match(cache, /workspace-health-cache\.json/);
  assert.match(cache, /entry\.target !== item\.uri/);
  assert.doesNotMatch(cache, /password|token|credential/i);
});

test('remote failures store generic details rather than raw backend messages', () => {
  assert.match(availability, /Remote location could not be reached\.'/);
  assert.doesNotMatch(availability, /detail:`Remote location could not be reached: \$\{error\.message\}`/);
});
