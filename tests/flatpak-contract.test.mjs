import test from 'node:test';
import assert from 'node:assert/strict';
import {flatpakListCommands, flatpakRunCommand, parseFlatpakListOutput} from '../src/services/flatpak-contract.js';

test('Flatpak list output preserves user and system installations', () => {
  const parsed = parseFlatpakListOutput([
    'Application\tName\tInstallation',
    'org.onlyoffice.desktopeditors\tONLYOFFICE Desktop Editors\tsystem',
    'org.gnome.Epiphany\tWeb\tuser',
    '',
  ].join('\n'));
  assert.deepEqual(parsed, [
    {application:'org.onlyoffice.desktopeditors', name:'ONLYOFFICE Desktop Editors', installation:'system', source:'flatpak-system'},
    {application:'org.gnome.Epiphany', name:'Web', installation:'user', source:'flatpak-user'},
  ]);
});

test('Flatpak two-column output uses the explicit installation hint', () => {
  assert.deepEqual(
    parseFlatpakListOutput('org.onlyoffice.desktopeditors\tONLYOFFICE Desktop Editors\n', 'system'),
    [{application:'org.onlyoffice.desktopeditors', name:'ONLYOFFICE Desktop Editors', installation:'system', source:'flatpak-system'}],
  );
  assert.deepEqual(
    parseFlatpakListOutput('org.gnome.Epiphany\tWeb\n', 'user'),
    [{application:'org.gnome.Epiphany', name:'Web', installation:'user', source:'flatpak-user'}],
  );
});

test('Flatpak list parser rejects malformed identifiers and duplicates', () => {
  const parsed = parseFlatpakListOutput([
    'not an id\tBad\tuser',
    'org.example.App\tExample\tuser',
    'org.example.App\tDuplicate\tuser',
  ].join('\n'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Example');
});

test('Flatpak inventory uses explicit user/system queries plus a combined compatibility query', () => {
  assert.deepEqual(flatpakListCommands(true), [
    {
      installationHint:'user',
      argv:['flatpak-spawn', '--host', 'flatpak', '--user', 'list', '--app', '--columns=application:full,name:full'],
    },
    {
      installationHint:'system',
      argv:['flatpak-spawn', '--host', 'flatpak', '--system', 'list', '--app', '--columns=application:full,name:full'],
    },
    {
      installationHint:'',
      argv:['flatpak-spawn', '--host', 'flatpak', 'list', '--app', '--columns=application:full,name:full,installation:full'],
    },
  ]);
});

test('Flatpak run commands use fixed argument arrays without shell strings', () => {
  assert.deepEqual(flatpakRunCommand('org.onlyoffice.desktopeditors', 'flatpak-system', true, 'system'), [
    'flatpak-spawn', '--host', 'flatpak', '--system', 'run', 'org.onlyoffice.desktopeditors',
  ]);
  assert.deepEqual(flatpakRunCommand('org.gnome.Epiphany', 'flatpak-user', false, 'user'), [
    'flatpak', '--user', 'run', 'org.gnome.Epiphany',
  ]);
  assert.deepEqual(flatpakRunCommand('org.example.Managed', 'flatpak-system', true, 'work'), [
    'flatpak-spawn', '--host', 'flatpak', '--installation=work', 'run', 'org.example.Managed',
  ]);
  assert.throws(() => flatpakRunCommand('bad id', 'flatpak-user', true), /Invalid Flatpak/);
});
