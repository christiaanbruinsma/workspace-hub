import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  syncTileEditorSaveResponse,
  tileEditorNameIsValid,
} from '../src/ui/tile-editor-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('tile editor name validation rejects empty and whitespace-only values', () => {
  assert.equal(tileEditorNameIsValid(''), false);
  assert.equal(tileEditorNameIsValid('   \t\n'), false);
  assert.equal(tileEditorNameIsValid(null), false);
  assert.equal(tileEditorNameIsValid(undefined), false);
});

test('tile editor name validation accepts visible text after trimming', () => {
  assert.equal(tileEditorNameIsValid('Apostrophe'), true);
  assert.equal(tileEditorNameIsValid('  Apostrophe  '), true);
});

test('save response follows the current entry text without submitting the dialog', () => {
  const states = [];
  const dialog = {
    set_response_enabled(responseId, enabled) {
      states.push({responseId, enabled});
    },
  };
  const titleRow = {
    value: '',
    get_text() {
      return this.value;
    },
  };

  assert.equal(syncTileEditorSaveResponse(dialog, titleRow), false);
  titleRow.value = '   ';
  assert.equal(syncTileEditorSaveResponse(dialog, titleRow), false);
  titleRow.value = 'Apostrophe';
  assert.equal(syncTileEditorSaveResponse(dialog, titleRow), true);
  titleRow.value = '';
  assert.equal(syncTileEditorSaveResponse(dialog, titleRow), false);

  assert.deepEqual(states, [
    {responseId: 'save', enabled: false},
    {responseId: 'save', enabled: false},
    {responseId: 'save', enabled: true},
    {responseId: 'save', enabled: false},
  ]);
});

test('window wires required-name validation before presenting the tile editor', () => {
  const windowSource = read('src/window.js');
  const sourceMeson = read('src/meson.build');
  const testMeson = read('tests/meson.build');

  assert.match(windowSource, /import \{syncTileEditorSaveResponse\} from '\.\/ui\/tile-editor-validation\.js'/);
  assert.match(windowSource, /const syncSaveResponse = \(\) => syncTileEditorSaveResponse\(dialog, titleRow\)/);
  assert.match(windowSource, /titleRow\.connect\('changed', syncSaveResponse\)/);
  assert.match(windowSource, /syncSaveResponse\(\);[\s\S]*dialog\.present\(this\)/);
  assert.match(windowSource, /if \(!title\) \{[\s\S]*A name is required/);
  assert.match(sourceMeson, /ui\/tile-editor-validation\.js/);
  assert.match(testMeson, /tile-editor-validation\.test\.mjs/);
  assert.match(testMeson, /tile-editor-validation-gjs\.test\.js/);
});
