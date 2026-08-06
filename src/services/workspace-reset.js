import {validateProfile} from './profile-contract.js';
import {DEFAULT_SECTION_TAB_ID, TABBED_SECTION_NAMES} from './section-tabs.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function resetWorkspaceContent(profile) {
  const next = clone(validateProfile(profile));

  for (const sectionName of Object.keys(next.sections))
    next.sections[sectionName] = [];

  for (const sectionName of TABBED_SECTION_NAMES) {
    next.settings.section_tabs[sectionName] = {
      tabs: [{
        id: DEFAULT_SECTION_TAB_ID,
        title: 'General',
        position: 1,
        is_default: true,
      }],
      active_tab_id: DEFAULT_SECTION_TAB_ID,
    };
  }

  return validateProfile(next);
}
