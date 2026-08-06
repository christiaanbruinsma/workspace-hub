import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {summariseDiagnostics} from './diagnostic-contract.js';
import {HealthStore} from './health-store.js';
import {ApplicationCatalog} from './application-catalog.js';

function normaliseLocalFile(value) {
  if (value.startsWith('~/'))
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), value.slice(2)]));
  if (value.startsWith('/'))
    return Gio.File.new_for_path(value);
  if (value.startsWith('file:'))
    return Gio.File.new_for_uri(value);
  return null;
}

function isRemotePlace(value) {
  return /^(smb:|dav:|davs:)/i.test(value);
}

export class AvailabilityService {
  constructor(applicationCatalog = new ApplicationCatalog()) {
    this.healthStore = new HealthStore();
    this.applicationCatalog = applicationCatalog;
  }

  checkProfile(profile) {
    this.applicationCatalog.refresh();
    const checks = [];
    for (const [section, items] of Object.entries(profile.sections)) {
      for (const item of items.filter(entry => entry.enabled !== false))
        checks.push(this.checkItem(section, item));
    }
    return {
      checkedAt: GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S%z'),
      browser: this.detectDefaultBrowser(),
      checks,
      summary: summariseDiagnostics(checks),
    };
  }

  checkItem(section, item) {
    const base = {id:item.id, section, type:item.type, title:item.title, item};
    if (item.type === 'application') {
      const application = this.applicationCatalog.resolveItem(item);
      return {
        ...base,
        status: application ? 'available' : 'missing',
        detail: application
          ? `${application.sourceLabel} application is available`
          : 'Configured application is not installed or not visible in the host application catalog',
      };
    }
    if (item.type === 'web') {
      const valid = /^(https?:|mailto:)/i.test(item.url);
      return {...base, status:valid ? 'valid' : 'invalid', detail:valid ? 'Address is structurally valid; network availability was not tested' : 'Address is invalid'};
    }
    if (item.type === 'place') {
      const local = normaliseLocalFile(item.uri);
      if (local) {
        const available = local.query_exists(null);
        return {...base, status:available ? 'available' : 'missing', detail:available ? 'Local location exists' : 'Local location does not exist'};
      }
      if (isRemotePlace(item.uri)) {
        const cached = this.healthStore.getRemoteResult(item);
        if (cached)
          return {...base, status:cached.status, detail:`${cached.detail} Last manually checked ${cached.checked_at}.`, checkedAt:cached.checked_at, manual:true};
        return {...base, status:'not-checked', detail:'Shared location is configured; reachability was not checked automatically'};
      }
      return {...base, status:'invalid', detail:'Location type is not supported'};
    }
    if (item.type === 'action') {
      const supported = item.action === 'support-report';
      return {...base, status:supported ? 'supported' : 'unsupported', detail:supported ? 'Built-in Workspace Hub action is supported' : 'Built-in action is not supported'};
    }
    return {...base, status:'unsupported', detail:'Unsupported workspace item type'};
  }

  checkRemotePlace(item, callback) {
    if (item.type !== 'place' || !isRemotePlace(item.uri)) {
      callback(new Error('This item is not a supported remote location'), null);
      return;
    }
    const file = Gio.File.new_for_uri(item.uri);
    file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (source, result) => {
      try {
        source.query_info_finish(result);
        const cached = this.healthStore.setRemoteResult(item, {status:'remote-available', detail:'Remote location responded successfully.'});
        callback(null, cached);
      } catch (error) {
        logError(error, `Remote location check failed for ${item.id}`);
        const cached = this.healthStore.setRemoteResult(item, {status:'remote-unavailable', detail:'Remote location could not be reached.'});
        callback(null, cached);
      }
    });
  }

  detectDefaultBrowser() {
    try {
      const catalogApp = this.applicationCatalog.defaultForScheme('https');
      if (catalogApp) {
        return {name:catalogApp.name, id:catalogApp.desktopId, detected:true, source:catalogApp.source};
      }
      const appInfo = Gio.AppInfo.get_default_for_uri_scheme('https');
      return {
        name: appInfo?.get_display_name?.() || appInfo?.get_name?.() || 'Not detected',
        id: appInfo?.get_id?.() || '',
        detected: Boolean(appInfo),
        source: appInfo ? 'sandbox' : 'unknown',
      };
    } catch (error) {
      logError(error, 'Unable to detect the default browser');
      return {name:'Not detected', id:'', detected:false};
    }
  }
}
