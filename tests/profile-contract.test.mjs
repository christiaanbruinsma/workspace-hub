import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE, cloneDefaultProfile} from '../src/services/default-profile.js';
import {CURRENT_SCHEMA_VERSION, normaliseProfile, profileSummary, serializeProfile, validateProfile} from '../src/services/profile-contract.js';

test('default profile validates and contains all MVP sections', () => {
  assert.equal(validateProfile(cloneDefaultProfile()).format, 'workspace-hub-profile');
  const summary = profileSummary(DEFAULT_PROFILE);
  assert.deepEqual(summary, {
    name: 'Example Workspace',
    organisation: 'Example Company',
    revision: '2026.08.02',
    source: 'example',
    apps: 6,
    webApps: 4,
    places: 5,
    dailyTools: 3,
    supportActions: 4,
  });
});

test('schema version 1 profiles are migrated without losing workspace content', () => {
  const old = cloneDefaultProfile();
  old.schema_version = 1;
  delete old.profile.source;
  old.status = old.status.map(({source, ...item}) => ({...item, value: 'Legacy value'}));
  const migrated = normaliseProfile(old);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.profile.source, 'example');
  assert.equal(migrated.sections.apps.length, 6);
  assert.equal(migrated.status.find(item => item.id === 'backup').value, 'Not checked');
});

test('web apps explicitly use URLs and applications use desktop IDs', () => {
  for (const item of DEFAULT_PROFILE.sections.web_apps)
    assert.match(item.url, /^(https?:|mailto:)/);
  for (const item of [...DEFAULT_PROFILE.sections.apps, ...DEFAULT_PROFILE.sections.daily_tools])
    assert.match(item.desktop_id, /\.desktop$/);
});

test('profile serialization is deterministic schema 12 JSON with trailing newline', () => {
  const text = serializeProfile(cloneDefaultProfile());
  assert.equal(text.endsWith('\n'), true);
  assert.equal(JSON.parse(text).schema_version, CURRENT_SCHEMA_VERSION);
});

test('invalid duplicate tile IDs are rejected', () => {
  const profile = cloneDefaultProfile();
  profile.sections.web_apps[0].id = profile.sections.apps[0].id;
  assert.throws(() => validateProfile(profile), /Duplicate tile id/);
});

test('status provenance is required for governance transparency', () => {
  const profile = cloneDefaultProfile();
  delete profile.status[0].source;
  assert.throws(() => validateProfile(profile), /source is unsupported/);
});


test('schema version 2 profiles gain onboarding, icon and visibility defaults', () => {
  const old = cloneDefaultProfile();
  old.schema_version = 2;
  delete old.settings.setup_completed;
  delete old.settings.icon_style;
  delete old.settings.section_visibility;
  const migrated = normaliseProfile(old);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.settings.icon_style, 'system');
  assert.equal(migrated.settings.setup_completed, false);
  assert.equal(migrated.settings.section_visibility.web_apps, true);
});

test('unsupported icon styles and incomplete visibility settings are rejected', () => {
  const badStyle = cloneDefaultProfile();
  badStyle.settings.icon_style = 'unknown';
  assert.throws(() => validateProfile(badStyle), /icon_style is unsupported/);
  const badVisibility = cloneDefaultProfile();
  delete badVisibility.settings.section_visibility.apps;
  assert.throws(() => validateProfile(badVisibility), /section_visibility\.apps/);
});


test('schema version 3 profiles gain governance origin and lock fields', () => {
  const old = cloneDefaultProfile();
  old.schema_version = 3;
  for (const items of Object.values(old.sections))
    for (const item of items) {
      delete item.origin;
      delete item.locked;
    }
  const migrated = normaliseProfile(old);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.sections.apps[0].origin, 'example');
  assert.equal(migrated.sections.apps[0].locked, false);
});

test('tile governance fields are required and validated', () => {
  const missingOrigin = cloneDefaultProfile();
  delete missingOrigin.sections.apps[0].origin;
  assert.throws(() => validateProfile(missingOrigin), /origin is unsupported/);
  const invalidLock = cloneDefaultProfile();
  invalidLock.sections.apps[0].locked = 'yes';
  assert.throws(() => validateProfile(invalidLock), /locked must be true or false/);
});


test('legacy workspace language is removed from schema 12 workspace profiles', () => {
  const old = cloneDefaultProfile();
  old.schema_version = 4;
  old.settings.language = 'nl';
  const migrated = normaliseProfile(old);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal('language' in migrated.settings, false);
});

test('profile limits reject excessive items and oversized labels', () => {
  const tooMany = cloneDefaultProfile();
  const template = tooMany.sections.web_apps[0];
  tooMany.sections.web_apps = Array.from({length:501}, (_, index) => ({...template, id:`site-${index}`, position:index + 1}));
  for (const section of ['apps','files_places','daily_tools','help_support'])
    tooMany.sections[section] = [];
  assert.throws(() => validateProfile(tooMany), /too many items/);
  const longTitle = cloneDefaultProfile();
  longTitle.sections.apps[0].title = 'x'.repeat(121);
  assert.throws(() => validateProfile(longTitle), /title is too long/);
});

test('schema version 5 profiles migrate through schema 7 without losing legacy style intent', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 5;
  legacy.settings.icon_style = 'workspace-grey';
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.settings.icon_style, 'fluent-linux-grey');
  assert.equal(migrated.sections.apps.find(item => item.id === 'email').icon_name, 'thunderbird');
});

test('schema 12 accepts all four supported dashboard icon styles', () => {
  for (const iconStyle of ['fluent-linux-color', 'fluent-linux-grey', 'fluent-ui-color', 'system']) {
    const profile = cloneDefaultProfile();
    profile.settings.icon_style = iconStyle;
    assert.equal(validateProfile(profile).settings.icon_style, iconStyle);
  }
});


test('schema version 6 preserves legacy icon choices during migration', () => {
  const cases = new Map([
    ['fluent-color', 'fluent-ui-color'],
    ['fluent-grey', 'fluent-linux-grey'],
    ['system', 'system'],
  ]);
  for (const [legacyStyle, expectedStyle] of cases) {
    const legacy = cloneDefaultProfile();
    legacy.schema_version = 6;
    legacy.settings.icon_style = legacyStyle;
    assert.equal(normaliseProfile(legacy).settings.icon_style, expectedStyle);
  }
});

test('new profiles default to Fluent Linux Color', () => {
  assert.equal(DEFAULT_PROFILE.schema_version, 12);
  assert.equal(DEFAULT_PROFILE.settings.application_icon_policy, 'application');
  for (const items of Object.values(DEFAULT_PROFILE.sections))
    for (const item of items)
      if (item.type === 'application')
        assert.equal(item.icon_override, 'inherit');
  assert.equal(DEFAULT_PROFILE.settings.icon_style, 'fluent-linux-color');
});


test('schema version 7 adds package-source provenance to application tiles', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 7;
  for (const items of Object.values(legacy.sections))
    for (const item of items)
      if (item.type === 'application')
        delete item.application_source;
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.sections.apps[0].application_source, 'unknown');
});

test('application package sources are validated', () => {
  const profile = cloneDefaultProfile();
  profile.sections.apps[0].application_source = 'unsupported-package';
  assert.throws(() => validateProfile(profile), /application_source is unsupported/);
});


test('schema version 8 profiles gain hybrid application icon defaults', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 8;
  delete legacy.settings.application_icon_policy;
  for (const items of Object.values(legacy.sections))
    for (const item of items)
      if (item.type === 'application')
        delete item.icon_override;
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.settings.application_icon_policy, 'application');
  assert.equal(migrated.sections.apps[0].icon_override, 'inherit');
});

test('application icon policy and per-app overrides are validated', () => {
  const badPolicy = cloneDefaultProfile();
  badPolicy.settings.application_icon_policy = 'unknown';
  assert.throws(() => validateProfile(badPolicy), /application_icon_policy is unsupported/);

  const badOverride = cloneDefaultProfile();
  badOverride.sections.apps[0].icon_override = 'unknown';
  assert.throws(() => validateProfile(badOverride), /icon_override is unsupported/);

  for (const policy of ['application', 'dashboard']) {
    const profile = cloneDefaultProfile();
    profile.settings.application_icon_policy = policy;
    assert.equal(validateProfile(profile).settings.application_icon_policy, policy);
  }
  for (const override of ['inherit', 'application', 'dashboard']) {
    const profile = cloneDefaultProfile();
    profile.sections.apps[0].icon_override = override;
    assert.equal(validateProfile(profile).sections.apps[0].icon_override, override);
  }
});


test('schema version 9 profiles gain semantic web icon roles', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 9;
  for (const items of Object.values(legacy.sections))
    for (const item of items)
      if (item.type === 'web')
        delete item.icon_role;
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.sections.web_apps.find(item => item.id === 'accounting').icon_role, 'accounting');
  assert.equal(migrated.sections.web_apps.find(item => item.id === 'crm').icon_role, 'people');
  assert.equal(migrated.sections.help_support.find(item => item.id === 'guide').icon_role, 'guide');
});

test('web icon roles are required and validated', () => {
  const profile = cloneDefaultProfile();
  profile.sections.web_apps[0].icon_role = 'unsupported';
  assert.throws(() => validateProfile(profile), /icon_role is unsupported/);
  const validRoles = ['web', 'accounting', 'people', 'board', 'calendar', 'document', 'mail', 'support', 'guide', 'apps', 'folder', 'backup'];
  for (const role of validRoles) {
    const valid = cloneDefaultProfile();
    valid.sections.web_apps[0].icon_role = role;
    assert.equal(validateProfile(valid).sections.web_apps[0].icon_role, role);
  }
});


test('schema version 10 profiles migrate through workspace-only schema 11 to schema 12', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 10;
  legacy.settings.language = 'de';
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  assert.equal('language' in migrated.settings, false);
  assert.equal(migrated.sections.apps.length, legacy.sections.apps.length);
});


test('schema version 11 profiles gain one General tab per supported section', () => {
  const legacy = cloneDefaultProfile();
  legacy.schema_version = 11;
  delete legacy.settings.section_tabs;
  for (const sectionName of ['apps', 'web_apps', 'files_places', 'daily_tools'])
    for (const item of legacy.sections[sectionName])
      delete item.tab_id;
  const migrated = normaliseProfile(legacy);
  assert.equal(migrated.schema_version, CURRENT_SCHEMA_VERSION);
  for (const sectionName of ['apps', 'web_apps', 'files_places', 'daily_tools']) {
    assert.deepEqual(migrated.settings.section_tabs[sectionName], {
      tabs: [{id:'general', title:'General', position:1, is_default:true}],
      active_tab_id: 'general',
    });
    assert.equal(migrated.sections[sectionName].every(item => item.tab_id === 'general'), true);
  }
  assert.equal(migrated.sections.help_support.every(item => item.tab_id === undefined), true);
});

test('tab configuration and tile assignments fail closed when inconsistent', () => {
  const missingTabs = cloneDefaultProfile();
  delete missingTabs.settings.section_tabs.apps;
  assert.throws(() => validateProfile(missingTabs), /section_tabs\.apps/);

  const unknownTab = cloneDefaultProfile();
  unknownTab.sections.apps[0].tab_id = 'missing';
  assert.throws(() => validateProfile(unknownTab), /tab_id must identify a tab/);

  const duplicateTab = cloneDefaultProfile();
  duplicateTab.settings.section_tabs.apps.tabs.push({id:'general', title:'Duplicate', position:2, is_default:false});
  assert.throws(() => validateProfile(duplicateTab), /Duplicate tab id/);

  const unsupported = cloneDefaultProfile();
  unsupported.sections.help_support[0].tab_id = 'general';
  assert.throws(() => validateProfile(unsupported), /tab_id is not supported/);
});


test('section tab defaults and positions are validated fail-closed', () => {
  const wrongDefault = cloneDefaultProfile();
  wrongDefault.settings.section_tabs.apps.tabs[0].id = 'other';
  wrongDefault.settings.section_tabs.apps.active_tab_id = 'other';
  assert.throws(() => validateProfile(wrongDefault), /must use general as its default tab/);

  const duplicatePosition = cloneDefaultProfile();
  duplicatePosition.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:1, is_default:false});
  assert.throws(() => validateProfile(duplicatePosition), /Duplicate tab position/);

  const nonContiguous = cloneDefaultProfile();
  nonContiguous.settings.section_tabs.apps.tabs.push({id:'design', title:'Design', position:3, is_default:false});
  assert.throws(() => validateProfile(nonContiguous), /positions must be contiguous/);

  const duplicateTitle = cloneDefaultProfile();
  duplicateTitle.settings.section_tabs.apps.tabs.push({id:'another-general', title:' general ', position:2, is_default:false});
  assert.throws(() => validateProfile(duplicateTitle), /Duplicate tab title/);
});
