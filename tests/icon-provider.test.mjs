import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ICON_STYLES,
  WEB_ICON_ROLES,
  iconStyleDescription,
  iconStyleLabel,
  normaliseIconStyle,
  normaliseWebIconRole,
  resolveStatusIcon,
  resolveSummaryIcon,
  resolveTileIcon,
  webIconRoleLabel,
} from '../src/services/icon-provider.js';

test('icon styles are ordered with Fluent Linux Color as the default choice', () => {
  assert.deepEqual(ICON_STYLES, [
    'fluent-linux-color',
    'fluent-linux-grey',
    'fluent-ui-color',
    'system',
  ]);
  assert.equal(normaliseIconStyle('invalid'), 'fluent-linux-color');
});

test('Inherit Theme preserves application and desktop theme icon names', () => {
  const item = {id:'email', type:'application', icon_name:'thunderbird'};
  assert.equal(resolveTileIcon(item, 'system'), 'thunderbird');
  assert.equal(iconStyleLabel('system'), 'Inherit Theme');
  assert.match(iconStyleDescription('system'), /inherited from your Linux desktop/);
});

test('Fluent Linux Color uses bundled Vinceliuice dashboard icons', () => {
  assert.equal(resolveTileIcon({id:'email', type:'application'}, 'fluent-linux-color'), 'workspace-hub-fluent-linux-color-mail');
  assert.equal(resolveTileIcon({id:'custom', type:'web'}, 'fluent-linux-color'), 'workspace-hub-fluent-linux-color-web');
  assert.equal(resolveSummaryIcon('files_places', 'fluent-linux-color'), 'workspace-hub-fluent-linux-color-folder');
  assert.equal(resolveStatusIcon('backup', 'drive-harddisk-symbolic', 'fluent-linux-color'), 'workspace-hub-fluent-linux-color-backup');
  assert.equal(iconStyleLabel('fluent-linux-color'), 'Fluent Linux Color');
});

test('Fluent Linux Grey uses the authentic grey Linux theme namespace', () => {
  assert.equal(resolveTileIcon({id:'email', type:'application'}, 'fluent-linux-grey'), 'workspace-hub-fluent-linux-grey-mail');
  assert.equal(resolveTileIcon({id:'custom', type:'place'}, 'fluent-linux-grey'), 'workspace-hub-fluent-linux-grey-folder');
  assert.equal(resolveSummaryIcon('support', 'fluent-linux-grey'), 'workspace-hub-fluent-linux-grey-support');
  assert.equal(iconStyleLabel('fluent-linux-grey'), 'Fluent Linux Grey');
});

test('Fluent UI Color preserves the legacy Microsoft colour option', () => {
  assert.equal(resolveTileIcon({id:'email', type:'application'}, 'fluent-ui-color'), 'workspace-hub-fluent-ui-color-mail');
  assert.equal(resolveSummaryIcon('apps', 'fluent-ui-color'), 'workspace-hub-fluent-ui-color-apps');
  assert.equal(iconStyleLabel('fluent-ui-color'), 'Fluent UI Color');
});

test('unknown bundled-theme applications fall back to their real desktop application icon', () => {
  for (const style of ['fluent-linux-color', 'fluent-linux-grey', 'fluent-ui-color'])
    assert.equal(resolveTileIcon({id:'custom-app', type:'application'}, style), null);
});

test('legacy style values migrate without changing their meaning', () => {
  assert.equal(normaliseIconStyle('workspace-grey'), 'fluent-linux-grey');
  assert.equal(normaliseIconStyle('fluent-grey'), 'fluent-linux-grey');
  assert.equal(normaliseIconStyle('fluent-color'), 'fluent-ui-color');
});


test('semantic web icon roles follow the active dashboard style', () => {
  assert.equal(WEB_ICON_ROLES.length, 12);
  assert.equal(normaliseWebIconRole('invalid'), 'web');
  assert.equal(webIconRoleLabel('accounting'), 'Accounting');
  assert.equal(resolveTileIcon({id:'custom', type:'web', icon_role:'accounting'}, 'fluent-linux-color'), 'workspace-hub-fluent-linux-color-accounting');
  assert.equal(resolveTileIcon({id:'custom', type:'web', icon_role:'people'}, 'fluent-linux-grey'), 'workspace-hub-fluent-linux-grey-people');
  assert.equal(resolveTileIcon({id:'custom', type:'web', icon_role:'board'}, 'fluent-ui-color'), 'workspace-hub-fluent-ui-color-board');
  assert.equal(resolveTileIcon({id:'custom', type:'web', icon_role:'mail'}, 'system'), 'mail-send-symbolic');
});
