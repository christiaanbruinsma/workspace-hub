import test from 'node:test';
import assert from 'node:assert/strict';
import {languageLabel, resolveLanguage, translate} from '../src/services/i18n.js';

test('system language resolves to supported English, Dutch or German', () => {
  assert.equal(resolveLanguage('system', ['nl_NL.UTF-8','en_US']), 'nl');
  assert.equal(resolveLanguage('system', ['fr_FR','de_DE']), 'de');
  assert.equal(resolveLanguage('system', ['fr_FR']), 'en');
});

test('primary navigation and greeting are translated', () => {
  assert.equal(translate('settings', 'nl'), 'Instellingen');
  assert.equal(translate('help_support', 'de'), 'Hilfe & Support');
  assert.equal(translate('greeting', 'nl', {name:'Alex'}), 'Goedemorgen, Alex');
  assert.equal(languageLabel('de'), 'Deutsch');
});


test('dashboard context menus are translated', () => {
  assert.equal(translate('context_add_dashboard', 'nl'), 'Toevoegen aan dashboard');
  assert.equal(translate('context_move_earlier', 'de'), 'Weiter nach vorn');
  assert.equal(translate('context_remove', 'en'), 'Remove from Workspace Hub');
});

test('workspace switcher and lifecycle actions are translated', () => {
  assert.equal(translate('create_workspace', 'nl'), 'Werkplek maken');
  assert.equal(translate('manage_workspaces', 'de'), 'Arbeitsplätze verwalten');
  assert.equal(translate('copy_of_workspace', 'en', {name:'Example Company'}), 'Copy of Example Company');
});

test('section tab labels are translated', () => {
  assert.equal(translate('general_tab', 'nl'), 'Algemeen');
  assert.equal(translate('add_tab', 'de'), 'Tab hinzufügen');
  assert.equal(translate('add_tab_to_section', 'en', {section:'Apps'}), 'Add tab to Apps');
  assert.equal(translate('rename_tab', 'nl'), 'Tab hernoemen');
  assert.equal(translate('delete_tab', 'de'), 'Tab löschen');
  assert.equal(translate('move_items_to_tab', 'en'), 'Move items to');
});


test('move-to-tab actions and dialogs are translated', () => {
  assert.equal(translate('context_move_to_tab', 'nl'), 'Naar tab verplaatsen…');
  assert.equal(translate('destination_tab', 'de'), 'Ziel-Tab');
  assert.equal(translate('move_item_heading', 'en', {name:'Documents'}), 'Move Documents?');
  assert.equal(translate('item_moved_to_tab', 'nl', {name:'Documenten', tab:'Werk'}), 'Documenten verplaatst naar Werk');
  assert.equal(translate('cancel', 'de'), 'Abbrechen');
});


test('cross-workspace copy and move actions are translated', () => {
  assert.equal(translate('context_copy_to_workspace', 'nl'), 'Naar werkplek kopiëren…');
  assert.equal(translate('context_move_to_workspace', 'de'), 'In Arbeitsplatz verschieben…');
  assert.equal(translate('destination_workspace', 'en'), 'Destination workspace');
  assert.equal(translate('item_copied_to_workspace', 'nl', {name:'Documenten', workspace:'Klant'}), 'Documenten gekopieerd naar Klant');
  assert.match(translate('transfer_history_warning', 'de'), /übertragen/);
});

test('workspace content overwrite actions are translated', () => {
  for (const language of ['en', 'nl', 'de']) {
    assert.notEqual(translate('copy_workspace_contents', language), 'copy_workspace_contents');
    assert.match(translate('replace_workspace_contents_heading', language, {target: 'Target'}), /Target/);
    assert.match(translate('replace_workspace_contents_body', language, {source: 'Source', target: 'Target'}), /Source/);
    assert.notEqual(translate('workspace_contents_replaced', language, {source: 'Source', target: 'Target'}), 'workspace_contents_replaced');
  }
});
