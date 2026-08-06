export const DEFAULT_PROFILE = Object.freeze({
  format: 'workspace-hub-profile',
  schema_version: 12,
  profile: {
    id: 'example-workspace',
    name: 'Example Workspace',
    organisation: 'Example Company',
    revision: '2026.08.02',
    managed_by: 'Workspace Hub',
    source: 'example',
  },
  settings: {
    greeting_name: '',
    show_attention_banner: true,
    attention_title: 'Example workspace active',
    attention_message: 'Review and replace sample items before deployment',
    setup_completed: false,
    icon_style: 'fluent-linux-color',
    application_icon_policy: 'application',
    section_visibility: {
      apps: true,
      web_apps: true,
      files_places: true,
      workspace_status: true,
      help_support: true,
    },
    section_tabs: {
      apps: {tabs:[{id:'general', title:'General', position:1, is_default:true}], active_tab_id:'general'},
      web_apps: {tabs:[{id:'general', title:'General', position:1, is_default:true}], active_tab_id:'general'},
      files_places: {tabs:[{id:'general', title:'General', position:1, is_default:true}], active_tab_id:'general'},
      daily_tools: {tabs:[{id:'general', title:'General', position:1, is_default:true}], active_tab_id:'general'},
    },
  },
  sections: {
    apps: [
      {id:'email', type:'application', tab_id:'general', title:'Email', subtitle:'Thunderbird', icon_name:'thunderbird', desktop_id:'thunderbird.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:1, enabled:true},
      {id:'documents', type:'application', tab_id:'general', title:'Documents', subtitle:'OnlyOffice', icon_name:'org.onlyoffice.desktopeditors', desktop_id:'org.onlyoffice.desktopeditors.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:2, enabled:true},
      {id:'calendar', type:'application', tab_id:'general', title:'Calendar', subtitle:'GNOME Calendar', icon_name:'org.gnome.Calendar', desktop_id:'org.gnome.Calendar.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:3, enabled:true},
      {id:'passwords', type:'application', tab_id:'general', title:'Passwords', subtitle:'Proton Pass', icon_name:'me.proton.Pass', desktop_id:'me.proton.Pass.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:4, enabled:true},
      {id:'scanning', type:'application', tab_id:'general', title:'Scanning', subtitle:'Document Scanner', icon_name:'org.gnome.SimpleScan', desktop_id:'org.gnome.SimpleScan.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:5, enabled:true},
      {id:'meetings', type:'application', tab_id:'general', title:'Meetings', subtitle:'Zoom', icon_name:'Zoom', desktop_id:'Zoom.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:6, enabled:true},
    ],
    web_apps: [
      {id:'accounting', type:'web', tab_id:'general', title:'Accounting', subtitle:'Exact Online', icon_name:'applications-internet-symbolic', icon_role:'accounting', url:'https://start.exactonline.nl', origin:'example', locked:false, position:1, enabled:true},
      {id:'crm', type:'web', tab_id:'general', title:'CRM', subtitle:'Company CRM', icon_name:'system-users-symbolic', icon_role:'people', url:'https://example.com/crm', origin:'example', locked:false, position:2, enabled:true},
      {id:'projects', type:'web', tab_id:'general', title:'Project board', subtitle:'Trello', icon_name:'view-grid-symbolic', icon_role:'board', url:'https://trello.com', origin:'example', locked:false, position:3, enabled:true},
      {id:'portal', type:'web', tab_id:'general', title:'Company portal', subtitle:'Intranet', icon_name:'network-workgroup-symbolic', icon_role:'web', url:'https://example.com/intranet', origin:'example', locked:false, position:4, enabled:true},
    ],
    files_places: [
      {id:'documents-folder', type:'place', tab_id:'general', title:'My documents', subtitle:'~/Documents', icon_name:'folder-documents-symbolic', uri:'~/Documents', origin:'example', locked:false, position:1, enabled:true},
      {id:'company-files', type:'place', tab_id:'general', title:'Company files', subtitle:'Shared folder', icon_name:'folder-remote-symbolic', uri:'smb://fileserver/company', origin:'example', locked:false, position:2, enabled:true},
      {id:'incoming-scans', type:'place', tab_id:'general', title:'Incoming scans', subtitle:'~/Scans', icon_name:'folder-download-symbolic', uri:'~/Scans', origin:'example', locked:false, position:3, enabled:true},
      {id:'invoices', type:'place', tab_id:'general', title:'Invoices', subtitle:'~/Documents/Invoices', icon_name:'folder-symbolic', uri:'~/Documents/Invoices', origin:'example', locked:false, position:4, enabled:true},
      {id:'backups', type:'place', tab_id:'general', title:'Backups', subtitle:'External drive', icon_name:'drive-harddisk-symbolic', uri:'~/Backups', origin:'example', locked:false, position:5, enabled:true},
    ],
    daily_tools: [
      {id:'calculator', type:'application', tab_id:'general', title:'Calculator', subtitle:'GNOME Calculator', icon_name:'accessories-calculator-symbolic', desktop_id:'org.gnome.Calculator.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:1, enabled:true},
      {id:'screenshots', type:'application', tab_id:'general', title:'Screenshots', subtitle:'Screenshot tool', icon_name:'camera-photo-symbolic', desktop_id:'org.gnome.Screenshot.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:2, enabled:true},
      {id:'terminal', type:'application', tab_id:'general', title:'Terminal', subtitle:'Ptyxis', icon_name:'utilities-terminal-symbolic', desktop_id:'app.devsuite.Ptyxis.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:3, enabled:true},
    ],
    help_support: [
      {id:'guide', type:'web', title:'Open company guide', subtitle:'User guides and how-tos', icon_name:'help-browser-symbolic', icon_role:'guide', url:'https://example.com/guide', origin:'example', locked:false, position:1, enabled:true},
      {id:'remote-support', type:'application', title:'Request remote support', subtitle:'Get help from the IT team', icon_name:'com.rustdesk.RustDesk', desktop_id:'com.rustdesk.RustDesk.desktop', application_source:'unknown', icon_override:'inherit', origin:'example', locked:false, position:2, enabled:true},
      {id:'support-report', type:'action', title:'Create support report', subtitle:'Collect system information', icon_name:'document-save-symbolic', action:'support-report', origin:'example', locked:false, position:3, enabled:true},
      {id:'contact', type:'web', title:'Contact support', subtitle:'Email or support portal', icon_name:'mail-send-symbolic', icon_role:'mail', url:'mailto:support@example.com', origin:'example', locked:false, position:4, enabled:true},
    ],
  },
  status: [
    {id:'backup', title:'Backup', value:'Not checked', state:'unknown', source:'unchecked', icon_name:'drive-harddisk-symbolic'},
    {id:'updates', title:'System updates', value:'Not checked', state:'unknown', source:'unchecked', icon_name:'software-update-available-symbolic'},
    {id:'shared-files', title:'Shared files', value:'Configured', state:'info', source:'configured', icon_name:'folder-remote-symbolic'},
    {id:'browser', title:'Default browser', value:'Detected by system', state:'info', source:'detected', icon_name:'web-browser-symbolic'},
  ],
});

export function cloneDefaultProfile() {
  return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}

export function createEmptyProfile() {
  const profile = cloneDefaultProfile();
  profile.profile = {
    id: 'local-workspace',
    name: 'My Workspace',
    organisation: '',
    revision: '',
    managed_by: '',
    source: 'local',
  };
  profile.settings.greeting_name = '';
  profile.settings.show_attention_banner = false;
  profile.settings.setup_completed = true;
  for (const sectionName of Object.keys(profile.sections))
    profile.sections[sectionName] = [];
  return profile;
}
