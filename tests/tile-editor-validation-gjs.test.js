import {
  syncTileEditorSaveResponse,
  tileEditorNameIsValid,
} from '../src/ui/tile-editor-validation.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

assert(!tileEditorNameIsValid(''), 'Empty names must be rejected');
assert(!tileEditorNameIsValid('   '), 'Whitespace-only names must be rejected');
assert(tileEditorNameIsValid('Apostrophe'), 'Visible names must be accepted');

const states = [];
const dialog = {
  set_response_enabled(responseId, enabled) {
    states.push([responseId, enabled]);
  },
};
const titleRow = {
  value: '',
  get_text() {
    return this.value;
  },
};

assert(!syncTileEditorSaveResponse(dialog, titleRow), 'New empty editor must disable save');
titleRow.value = 'Apostrophe';
assert(syncTileEditorSaveResponse(dialog, titleRow), 'Valid editor name must enable save');
titleRow.value = '';
assert(!syncTileEditorSaveResponse(dialog, titleRow), 'Clearing an edit name must disable save again');
assert(states.length === 3, 'Every validation pass must set exactly one response state');
