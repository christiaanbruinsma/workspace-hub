import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('GJS application entrypoint uses runAsync with top-level await', () => {
  assert.match(mainSource, /const exitCode = await app\.runAsync\(\[GLib\.get_prgname\(\), \.\.\.ARGV\]\);/);
  assert.doesNotMatch(mainSource, /\bapp\.run\s*\(/);
  assert.match(mainSource, /export default exitCode;/);
});
