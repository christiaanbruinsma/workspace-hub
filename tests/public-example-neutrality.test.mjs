import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEFAULT_PROFILE} from '../src/services/default-profile.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEXT_EXTENSIONS = new Set([
  '', '.css', '.desktop', '.in', '.ini', '.js', '.json', '.md', '.mjs', '.po', '.pot', '.sh', '.svg', '.txt', '.xml', '.yml', '.yaml',
]);

function walkTextFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (name === '.git' || name === 'SHA256SUMS')
      continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkTextFiles(path));
      continue;
    }
    const extension = name.includes('.') ? `.${name.split('.').pop()}` : '';
    if (TEXT_EXTENSIONS.has(extension))
      files.push(path);
  }
  return files;
}

test('public example workspace uses neutral fictitious identity', () => {
  assert.equal(DEFAULT_PROFILE.profile.id, 'example-workspace');
  assert.equal(DEFAULT_PROFILE.profile.name, 'Example Workspace');
  assert.equal(DEFAULT_PROFILE.profile.organisation, 'Example Company');
  assert.equal(DEFAULT_PROFILE.profile.managed_by, 'Workspace Hub');
  assert.equal(DEFAULT_PROFILE.settings.greeting_name, '');
  assert.equal(
    DEFAULT_PROFILE.sections.help_support.find(item => item.id === 'contact')?.title,
    'Contact support',
  );
});

test('public source contains no private demo branding', () => {
  const privateBrand = ['In', 'fused'].join('');
  const privateGreetingName = ['Ch', 'ris'].join('');
  const legacyExampleId = `${privateBrand.toLowerCase()}-example-workspace`;
  const patterns = [
    new RegExp(privateBrand, 'i'),
    new RegExp(`\\b${privateGreetingName}\\b`),
    new RegExp(legacyExampleId, 'i'),
  ];
  const violations = [];
  for (const path of walkTextFiles(ROOT)) {
    const text = readFileSync(path, 'utf8');
    if (patterns.some(pattern => pattern.test(text)))
      violations.push(relative(ROOT, path));
  }
  assert.deepEqual(violations, []);
});
