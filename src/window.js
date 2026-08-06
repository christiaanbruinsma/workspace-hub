import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import {VERSION} from './config.js';
import {ProfileStore} from './services/profile-store.js';
import {profileSummary} from './services/profile-contract.js';
import {createUniqueTileId, moveWorkspaceItem, moveWorkspaceItemToTab, normaliseWorkspaceSectionPositions, removeWorkspaceItem, setWorkspaceItemGovernance, sortWorkspaceItems, upsertWorkspaceItem} from './services/workspace-items.js';
import {AvailabilityService} from './services/availability-service.js';
import {buildDiagnosticReport} from './services/diagnostic-contract.js';
import {resetWorkspaceContent} from './services/workspace-reset.js';
import {WEB_ICON_ROLES, iconStyleDescription, iconStyleLabel, normaliseIconStyle, normaliseWebIconRole, resolveStatusIcon, resolveSummaryIcon, resolveTileIcon, webIconRoleLabel} from './services/icon-provider.js';
import {diffProfiles, governanceLabel} from './services/governance-contract.js';
import {languageLabel, resolveLanguage, translate} from './services/i18n.js';
import {evaluateWorkspaceReadiness} from './services/readiness-contract.js';
import {ApplicationCatalog} from './services/application-catalog.js';
import {TABBED_SECTION_NAMES, activeSectionTabId, addSectionTab, moveSectionTab, removeSectionTab, renameSectionTab, reorderSectionTabs, sectionItemsForTab, sectionTabDisplayTitle, sectionTabs, setActiveSectionTab} from './services/section-tabs.js';
import {createItemActionsMenuButton} from './ui/item-actions-menu.js';
import {presentMoveItemToTabDialog} from './ui/move-item-to-tab-dialog.js';
import {presentTransferItemDialog} from './ui/transfer-item-dialog.js';
import {presentWorkspaceContentsDestinationDialog} from './ui/copy-workspace-contents-dialog.js';
import {createSectionControllerIdentity, disposeSectionController, sectionControllerMatches} from './ui/section-controller-contract.js';
import {buildTransferViewRefreshPlan} from './ui/transfer-view-reconciliation.js';
import {syncTileEditorSaveResponse} from './ui/tile-editor-validation.js';
import {WorkspaceActivationCoordinator} from './services/workspace-activation-coordinator.js';

const PAGE_WIDTH = 1540;
// The expanded split view needs about 961 px (sidebar + content minimum).
// Collapse before that boundary so libadwaita never has to over-allocate the
// ToastOverlay while the user resizes through the transition range.
const NAVIGATION_COLLAPSE_WIDTH = 1000;
const SECTION_TAB_TITLE_MAX_CHARS = 24;

const PAGE_TITLE_KEYS = Object.freeze({
  overview: ['overview', 'overview_desc'],
  apps: ['apps', 'apps_desc'],
  web_apps: ['web_apps', 'web_apps_desc'],
  files_places: ['files_places', 'files_places_desc'],
  daily_tools: ['daily_tools', 'daily_tools_desc'],
  help_support: ['help_support', 'help_support_desc'],
  workspace_status: ['workspace_status', 'workspace_status_desc'],
  settings: ['settings', 'settings_desc'],
});

export const WorkspaceHubWindow = GObject.registerClass(
class WorkspaceHubWindow extends Adw.ApplicationWindow {
  constructor(params = {}) {
    super({
      ...params,
      title: 'Workspace Hub',
      default_width: 1480,
      default_height: 900,
      width_request: 760,
      height_request: 620,
    });

    this._store = new ProfileStore();
    this._profile = this._store.profile;
    this._appCatalog = new ApplicationCatalog();
    this._availability = new AvailabilityService(this._appCatalog);
    this._diagnostics = this._computeDiagnostics(this._profile);
    this._currentPage = 'overview';
    this._sidebarRows = new Map();
    this._sidebarLists = [];
    this._adaptiveGrids = [];
    this._onboardingShown = false;
    this._workspaceManagerDialog = null;
    this._workspaceTransferDialogs = new Set();
    this._workspaceTransferOperations = new Set();
    this._workspaceActivationPending = false;
    this._viewGeneration = 0;
    this._sectionNotebookControllers = new Set();
    this._workspaceActivationCoordinator = new WorkspaceActivationCoordinator({
      getActiveWorkspaceId: () => this._store.library.active_workspace_id,
      commit: workspaceId => this._store.activateWorkspace(workspaceId),
      reconcile: workspaceId => this._reconcileWorkspaceActivation(workspaceId),
      onBusyChanged: pending => this._setWorkspaceActivationPending(pending),
      onError: error => {
        this._profile = this._store.profile;
        this._refreshWorkspaceView(this._currentPage);
        this._showError('Workspace could not be opened', error);
      },
    });
    this._installNavigationActions();

    this._toast = new Adw.ToastOverlay();
    this.set_content(this._toast);

    this._split = new Adw.NavigationSplitView();
    this._toast.set_child(this._split);
    this._split.set_sidebar(new Adw.NavigationPage({title: 'Workspace Hub', child: this._buildSidebar()}));
    this._beginViewGeneration();
    this._contentPage = new Adw.NavigationPage({title: this._pageMeta('overview')[0], child: this._buildPage('overview')});
    this._split.set_content(this._contentPage);

    const compactNavigation = new Adw.Breakpoint({
      condition: Adw.BreakpointCondition.parse(`max-width: ${NAVIGATION_COLLAPSE_WIDTH}px`),
    });
    compactNavigation.add_setter(this._split, 'collapsed', true);
    this.add_breakpoint(compactNavigation);

    this.connect('notify::width', () => this._updateLayout());
    this._contentPage.connect('notify::width', () => this._updateLayout());
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._updateLayout();
      if (this._store.warning)
        this._toast.add_toast(new Adw.Toast({title: this._store.warning, timeout: 12}));
      this._maybeShowOnboarding();
      return GLib.SOURCE_REMOVE;
    });
  }

  _language() {
    return resolveLanguage(this._store.applicationSettings.language, GLib.get_language_names());
  }

  _t(key, variables = {}) {
    return translate(key, this._language(), variables);
  }

  _plainActionRow(title, subtitle = '', properties = {}) {
    const row = new Adw.ActionRow({...properties, use_markup: false});
    row.set_title(String(title ?? ''));
    row.set_subtitle(String(subtitle ?? ''));
    return row;
  }

  _pageMeta(pageId) {
    const keys = PAGE_TITLE_KEYS[pageId];
    return keys ? [this._t(keys[0]), this._t(keys[1])] : ['', ''];
  }

  _popupMenu(parent, menuModel, actionGroup, namespace, x, y) {
    const popover = new Gtk.PopoverMenu({menu_model: menuModel, has_arrow: false, autohide: true});

    // Keep menu actions owned by the popover itself. Attaching a temporary
    // action group to the tile/background and removing it from the `closed`
    // signal can race with GTK action activation: the menu closes first and
    // the selected action then has no group left to resolve. The popover-owned
    // group remains valid for the complete activation cycle.
    popover.insert_action_group(namespace, actionGroup);
    popover.set_parent(parent);
    popover.set_pointing_to(new Gdk.Rectangle({
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: 1,
      height: 1,
    }));
    popover.connect('closed', () => {
      // Defer destruction until GTK has completed dispatching the selected
      // action. The popover and its action group remain alive for this main
      // loop turn, while still being cleaned up promptly afterwards.
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
          if (popover.get_parent())
            popover.unparent();
        } catch (error) {
          console.debug(`[Workspace Hub] Context menu cleanup skipped: ${error.message}`);
        }
        return GLib.SOURCE_REMOVE;
      });
    });
    popover.popup();
  }

  _addMenuAction(group, name, callback, enabled = true) {
    const action = new Gio.SimpleAction({name});
    action.set_enabled(Boolean(enabled));
    action.connect('activate', callback);
    group.add_action(action);
    return action;
  }

  _addStringMenuAction(group, name, value, callback) {
    const action = new Gio.SimpleAction({
      name,
      parameter_type: new GLib.VariantType('s'),
      state: new GLib.Variant('s', value),
    });
    action.connect('activate', (currentAction, parameter) => {
      const nextValue = String(parameter?.deep_unpack?.() ?? parameter?.unpack?.() ?? value);
      currentAction.set_state(new GLib.Variant('s', nextValue));
      callback(nextValue);
    });
    group.add_action(action);
    return action;
  }

  _addBooleanMenuAction(group, name, value, callback) {
    const action = new Gio.SimpleAction({name, state: new GLib.Variant('b', Boolean(value))});
    action.connect('activate', currentAction => {
      const nextValue = !Boolean(currentAction.get_state().get_boolean());
      currentAction.set_state(new GLib.Variant('b', nextValue));
      callback(nextValue);
    });
    group.add_action(action);
    return action;
  }

  _isInteractiveDashboardTarget(widget, root) {
    for (let current = widget; current && current !== root; current = current.get_parent?.()) {
      if (current instanceof Gtk.Button || current instanceof Gtk.Entry || current instanceof Gtk.DropDown || current instanceof Gtk.Switch)
        return true;
    }
    return false;
  }

  _attachTileContextMenu(widget, sectionName, item, controller = null) {
    const secondaryClick = new Gtk.GestureClick({button: Gdk.BUTTON_SECONDARY});
    secondaryClick.connect('pressed', (gesture, _pressCount, x, y) => {
      gesture.set_state(Gtk.EventSequenceState.CLAIMED);
      this._openTileContextMenu(widget, sectionName, item, x, y, controller);
    });
    widget.add_controller(secondaryClick);

    const keyboard = new Gtk.EventControllerKey();
    keyboard.connect('key-pressed', (_controller, keyval, _keycode, state) => {
      const keyboardMenu = keyval === Gdk.KEY_Menu;
      const shiftF10 = keyval === Gdk.KEY_F10 && Boolean(state & Gdk.ModifierType.SHIFT_MASK);
      if (!keyboardMenu && !shiftF10)
        return false;
      this._openTileContextMenu(widget, sectionName, item, widget.get_width() / 2, widget.get_height() / 2, controller);
      return true;
    });
    widget.add_controller(keyboard);
  }

  _openTileContextMenu(widget, sectionName, item, x, y, controller = null) {
    const returnPage = this._currentPage;
    const group = new Gio.SimpleActionGroup();
    const sortedItems = sortWorkspaceItems(this._profile.sections[sectionName] ?? []).filter(entry => entry.enabled !== false && (item.tab_id === undefined || entry.tab_id === item.tab_id));
    const index = sortedItems.findIndex(entry => entry.id === item.id);
    const editable = !item.locked;

    const moveDestinations = this._moveItemTabDestinations(sectionName, item);
    const workspaceDestinations = this._workspaceTransferDestinations(sectionName);

    this._addMenuAction(group, 'open', () => this._activateItem(item));
    this._addMenuAction(group, 'edit', () => this._openTileEditor(sectionName, item, returnPage), editable);
    if (moveDestinations.length > 0)
      this._addMenuAction(group, 'move-to-tab', () => this._showMoveItemToTabDialog(sectionName, item, returnPage, controller), editable);
    if (workspaceDestinations.length > 0) {
      this._addMenuAction(group, 'copy-to-workspace', () => this._showTransferItemDialog('copy', sectionName, item), editable);
      this._addMenuAction(group, 'move-to-workspace', () => this._showTransferItemDialog('move', sectionName, item), editable);
    }
    this._addMenuAction(group, 'move-earlier', () => this._moveTile(sectionName, item.id, 'up', returnPage), editable && index > 0);
    this._addMenuAction(group, 'move-later', () => this._moveTile(sectionName, item.id, 'down', returnPage), editable && index >= 0 && index < sortedItems.length - 1);
    this._addMenuAction(group, 'remove', () => this._confirmRemoveTile(sectionName, item, returnPage), editable);

    const menu = new Gio.Menu();
    const primary = new Gio.Menu();
    primary.append(this._t('context_open'), 'tile.open');
    primary.append(this._t('context_edit'), 'tile.edit');
    menu.append_section(null, primary);

    if (item.type === 'application') {
      const currentOverride = item.icon_override || 'inherit';
      const iconAction = new Gio.SimpleAction({
        name: 'icon',
        parameter_type: new GLib.VariantType('s'),
        state: new GLib.Variant('s', currentOverride),
      });
      iconAction.set_enabled(editable);
      iconAction.connect('activate', (currentAction, parameter) => {
        const override = String(parameter?.deep_unpack?.() ?? parameter?.unpack?.() ?? 'inherit');
        currentAction.set_state(new GLib.Variant('s', override));
        this._setTileIconOverride(sectionName, item, override);
      });
      group.add_action(iconAction);
      const iconMenu = new Gio.Menu();
      iconMenu.append(this._t('context_use_workspace_setting'), 'tile.icon::inherit');
      iconMenu.append(this._t('context_use_application_icon'), 'tile.icon::application');
      iconMenu.append(this._t('context_use_dashboard_icon_set'), 'tile.icon::dashboard');
      menu.append_submenu(this._t('context_icon'), iconMenu);
    }

    const ordering = new Gio.Menu();
    if (moveDestinations.length > 0)
      ordering.append(this._t('context_move_to_tab'), 'tile.move-to-tab');
    if (workspaceDestinations.length > 0) {
      ordering.append(this._t('context_copy_to_workspace'), 'tile.copy-to-workspace');
      ordering.append(this._t('context_move_to_workspace'), 'tile.move-to-workspace');
    }
    ordering.append(this._t('context_move_earlier'), 'tile.move-earlier');
    ordering.append(this._t('context_move_later'), 'tile.move-later');
    menu.append_section(null, ordering);

    const destructive = new Gio.Menu();
    destructive.append(this._t('context_remove'), 'tile.remove');
    menu.append_section(null, destructive);

    this._popupMenu(widget, menu, group, 'tile', x, y);
  }

  async _setTileIconOverride(sectionName, item, override) {
    try {
      const updated = JSON.parse(JSON.stringify(item));
      updated.icon_override = ['inherit', 'application', 'dashboard'].includes(override) ? override : 'inherit';
      const next = upsertWorkspaceItem(this._profile, sectionName, updated);
      await this._store.save(next, {
        action: 'item-icon-updated',
        summary: `Updated icon preference for ${item.title}`,
        details: {section: sectionName, item_id: item.id, icon_override: updated.icon_override},
      });
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._toast.add_toast(new Adw.Toast({title: 'Application icon updated'}));
      this._navigate('overview');
    } catch (error) {
      this._showError('Application icon could not be updated', error);
    }
  }

  _attachDashboardBackgroundContextMenu(widget) {
    const secondaryClick = new Gtk.GestureClick({button: Gdk.BUTTON_SECONDARY});
    secondaryClick.connect('pressed', (gesture, _pressCount, x, y) => {
      const picked = widget.pick(x, y, Gtk.PickFlags.DEFAULT);
      if (this._isInteractiveDashboardTarget(picked, widget))
        return;
      gesture.set_state(Gtk.EventSequenceState.CLAIMED);
      this._openDashboardContextMenu(widget, x, y);
    });
    widget.add_controller(secondaryClick);
  }

  _openDashboardContextMenu(widget, x, y) {
    const group = new Gio.SimpleActionGroup();
    this._addMenuAction(group, 'add-app', () => this._openTileEditor('apps', null));
    this._addMenuAction(group, 'add-web', () => this._openTileEditor('web_apps', null));
    this._addMenuAction(group, 'add-place', () => this._openTileEditor('files_places', null));
    this._addMenuAction(group, 'add-support', () => this._openTileEditor('help_support', null));
    this._addMenuAction(group, 'detect-apps', () => this._previewSmartApplicationSetup());
    this._addMenuAction(group, 'settings', () => this._navigate('settings'));

    const visibility = this._profile.settings.section_visibility;
    const visibilityActions = [
      ['show-apps', 'apps'],
      ['show-web-apps', 'web_apps'],
      ['show-files-places', 'files_places'],
      ['show-workspace-status', 'workspace_status'],
      ['show-help-support', 'help_support'],
    ];
    for (const [actionName, key] of visibilityActions)
      this._addBooleanMenuAction(group, actionName, visibility[key], value => this._setDashboardSectionVisibility(key, value));

    this._addStringMenuAction(group, 'icon-style', normaliseIconStyle(this._profile.settings.icon_style), value => this._setDashboardIconStyle(value));
    this._addStringMenuAction(group, 'application-icons', this._profile.settings.application_icon_policy || 'application', value => this._setApplicationIconPolicy(value));

    const menu = new Gio.Menu();
    const addMenu = new Gio.Menu();
    addMenu.append(this._t('context_add_application'), 'dashboard.add-app');
    addMenu.append(this._t('context_add_web'), 'dashboard.add-web');
    addMenu.append(this._t('context_add_place'), 'dashboard.add-place');
    addMenu.append(this._t('context_add_support'), 'dashboard.add-support');
    menu.append_submenu(this._t('context_add_dashboard'), addMenu);

    const sectionsMenu = new Gio.Menu();
    sectionsMenu.append(this._t('start_work'), 'dashboard.show-apps');
    sectionsMenu.append(this._t('web_heading'), 'dashboard.show-web-apps');
    sectionsMenu.append(this._t('places_heading'), 'dashboard.show-files-places');
    sectionsMenu.append(this._t('status_heading'), 'dashboard.show-workspace-status');
    sectionsMenu.append(this._t('support_heading'), 'dashboard.show-help-support');
    menu.append_submenu(this._t('context_show_sections'), sectionsMenu);

    const iconMenu = new Gio.Menu();
    iconMenu.append(this._t('fluent_linux_color'), 'dashboard.icon-style::fluent-linux-color');
    iconMenu.append(this._t('fluent_linux_grey'), 'dashboard.icon-style::fluent-linux-grey');
    iconMenu.append(this._t('fluent_ui_color'), 'dashboard.icon-style::fluent-ui-color');
    iconMenu.append(this._t('inherit_theme'), 'dashboard.icon-style::system');
    menu.append_submenu(this._t('context_icon_style'), iconMenu);

    const appIconMenu = new Gio.Menu();
    appIconMenu.append(this._t('context_use_application_icons'), 'dashboard.application-icons::application');
    appIconMenu.append(this._t('context_use_dashboard_icon_set'), 'dashboard.application-icons::dashboard');
    menu.append_submenu(this._t('context_application_icons'), appIconMenu);

    const management = new Gio.Menu();
    management.append(this._t('context_setup_computer'), 'dashboard.detect-apps');
    management.append(this._t('context_dashboard_settings'), 'dashboard.settings');
    menu.append_section(null, management);

    this._popupMenu(widget, menu, group, 'dashboard', x, y);
  }

  async _saveQuickAppearance(settingsPatch, historySummary) {
    try {
      const next = JSON.parse(JSON.stringify(this._profile));
      Object.assign(next.settings, settingsPatch);
      next.profile.source = 'local';
      await this._store.save(next, {action: 'dashboard-quick-setting', summary: historySummary});
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._toast.add_toast(new Adw.Toast({title: historySummary}));
      this._navigate('overview');
    } catch (error) {
      this._showError('Dashboard setting could not be updated', error);
    }
  }

  _setDashboardSectionVisibility(key, visible) {
    const sectionVisibility = {...this._profile.settings.section_visibility, [key]: Boolean(visible)};
    this._saveQuickAppearance({section_visibility: sectionVisibility}, 'Dashboard sections updated');
  }

  _setDashboardIconStyle(iconStyle) {
    const allowed = ['fluent-linux-color', 'fluent-linux-grey', 'fluent-ui-color', 'system'];
    this._saveQuickAppearance({icon_style: allowed.includes(iconStyle) ? iconStyle : 'fluent-linux-color'}, 'Dashboard icon style updated');
  }

  _setApplicationIconPolicy(policy) {
    this._saveQuickAppearance({application_icon_policy: policy === 'dashboard' ? 'dashboard' : 'application'}, 'Application icon policy updated');
  }

  _installNavigationActions() {
    const shortcuts = ['<primary>1', '<primary>2', '<primary>3', '<primary>4', '<primary>5', '<primary>6', '<primary>7', '<primary>8'];
    Object.keys(PAGE_TITLE_KEYS).forEach((pageId, index) => {
      const actionName = `nav-${pageId.replaceAll('_', '-')}`;
      const action = new Gio.SimpleAction({name: actionName});
      action.connect('activate', () => this._navigate(pageId));
      this.add_action(action);
      this.get_application()?.set_accels_for_action(`win.${actionName}`, [shortcuts[index]]);
    });
  }

  _workspaceSubtitle(summary) {
    if (summary.organisation)
      return summary.organisation;
    const itemCount = summary.apps + summary.webApps + summary.places + summary.dailyTools + summary.supportActions;
    return `${itemCount} configured item${itemCount === 1 ? '' : 's'}`;
  }

  _refreshWorkspaceView(pageId = this._currentPage) {
    this._profile = this._store.profile;
    this._refreshDiagnostics();
    this._rebuildSidebar();
    this._navigate(PAGE_TITLE_KEYS[pageId] ? pageId : 'overview');
  }

  _setWorkspaceActivationPending(pending) {
    this._workspaceActivationPending = Boolean(pending);
    const spinner = this._workspaceActivationPendingSpinner;
    if (!spinner)
      return;
    spinner.set_visible(this._workspaceActivationPending);
    spinner.set_spinning(this._workspaceActivationPending);
  }

  _reconcileWorkspaceActivation(_workspaceId) {
    const activeName = this._store.profile.profile.name;
    this._refreshWorkspaceView(this._currentPage);
    this._toast.add_toast(new Adw.Toast({title: `Switched to ${activeName}`}));
  }

  _activateWorkspace(workspaceId) {
    return this._workspaceActivationCoordinator.request(workspaceId);
  }

  _afterDialogClosed(dialog, callback) {
    let pending = true;
    dialog.connect('closed', () => {
      if (!pending)
        return;
      pending = false;
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        callback();
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  _singleLineNameField({dialog, label, initialText = '', responseId, unchangedText = null}) {
    const field = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      hexpand: true,
    });
    field.append(new Gtk.Label({
      label,
      xalign: 0,
      css_classes: ['dim-label'],
    }));

    const entry = new Gtk.Entry({
      text: initialText,
      width_chars: 30,
      hexpand: true,
      activates_default: true,
    });
    field.append(entry);

    const unchanged = unchangedText === null ? null : unchangedText.trim();
    const updateResponse = () => {
      const value = entry.get_text().trim();
      dialog.set_response_enabled(responseId, Boolean(value) && (unchanged === null || value !== unchanged));
    };
    entry.connect('changed', updateResponse);
    updateResponse();

    return {field, entry};
  }

  _promptWorkspaceName({heading, body = '', initialName = '', confirmLabel, onConfirm, requireChange = false}) {
    const dialog = new Adw.AlertDialog({heading, body});
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance('confirm', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('confirm');
    dialog.set_close_response('cancel');
    const {field, entry} = this._singleLineNameField({
      dialog,
      label: this._t('workspace_name'),
      initialText: initialName,
      responseId: 'confirm',
      unchangedText: requireChange ? initialName : null,
    });
    dialog.set_extra_child(field);
    let confirmedName = null;
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'confirm')
        return;
      const name = entry.get_text().trim();
      if (!name) {
        this._toast.add_toast(new Adw.Toast({title: 'Workspace name is required'}));
        return;
      }
      confirmedName = name;
    });
    this._afterDialogClosed(dialog, () => {
      if (confirmedName !== null)
        onConfirm(confirmedName);
    });
    dialog.present(this);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      entry.grab_focus();
      entry.select_region(0, -1);
      return GLib.SOURCE_REMOVE;
    });
  }

  _createWorkspace() {
    this._promptWorkspaceName({
      heading: this._t('create_workspace'),
      body: 'Create an empty workspace with its own dashboard, sections and appearance settings.',
      initialName: 'New Workspace',
      confirmLabel: this._t('create_workspace'),
      onConfirm: async name => {
        try {
          await this._store.createWorkspace(name, {activate: true});
          this._refreshWorkspaceView('overview');
          this._toast.add_toast(new Adw.Toast({title: `${name} created`}));
        } catch (error) {
          this._showError('Workspace could not be created', error);
        }
      },
    });
  }

  _renameWorkspace(summary) {
    this._promptWorkspaceName({
      heading: this._t('rename_workspace'),
      initialName: summary.name,
      confirmLabel: 'Rename',
      requireChange: true,
      onConfirm: async name => {
        try {
          await this._store.renameWorkspace(summary.id, name);
          this._refreshWorkspaceView(this._currentPage);
          this._toast.add_toast(new Adw.Toast({title: 'Workspace renamed'}));
        } catch (error) {
          this._showError('Workspace could not be renamed', error);
        }
      },
    });
  }

  _duplicateWorkspace(summary) {
    this._promptWorkspaceName({
      heading: this._t('duplicate_workspace'),
      body: 'All dashboard items and workspace settings are copied into a new independent workspace.',
      initialName: this._t('copy_of_workspace', {name: summary.name}),
      confirmLabel: 'Duplicate',
      onConfirm: async name => {
        try {
          await this._store.duplicateWorkspace(summary.id, name, {activate: true});
          this._refreshWorkspaceView('overview');
          this._toast.add_toast(new Adw.Toast({title: `${name} created`}));
        } catch (error) {
          this._showError('Workspace could not be duplicated', error);
        }
      },
    });
  }

  _copyWorkspaceContents(summary) {
    const destinations = this._store.getWorkspaceContentsCopyDestinations(summary.id);
    if (destinations.length === 0) {
      this._toast.add_toast(new Adw.Toast({title: this._t('no_workspace_copy_targets')}));
      return;
    }

    presentWorkspaceContentsDestinationDialog({
      parent: this,
      destinations,
      heading: this._t('copy_workspace_contents_heading'),
      body: this._t('copy_workspace_contents_body'),
      workspaceLabel: this._t('destination_workspace'),
      cancelLabel: this._t('cancel'),
      continueLabel: this._t('copy'),
      onSelect: destination => this._confirmCopyWorkspaceContents(summary, destination),
      onError: error => this._showError('Workspace destination could not be selected', error),
    });
  }

  _confirmCopyWorkspaceContents(source, target) {
    const dialog = new Adw.AlertDialog({
      heading: this._t('replace_workspace_contents_heading', {target: target.name}),
      body: this._t('replace_workspace_contents_body', {
        source: source.name,
        target: target.name,
      }),
      heading_use_markup: false,
      body_use_markup: false,
    });
    dialog.add_response('cancel', this._t('cancel'));
    dialog.add_response('replace', this._t('replace_workspace_contents'));
    dialog.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'replace')
        return;
      try {
        await this._store.copyWorkspaceContents(source.id, target.id);
        this._refreshWorkspaceView(this._currentPage);
        this._toast.add_toast(new Adw.Toast({
          title: this._t('workspace_contents_replaced', {
            source: source.name,
            target: target.name,
          }),
        }));
      } catch (error) {
        this._showError('Workspace contents could not be copied', error);
      }
    });
    dialog.present(this);
  }

  _archiveWorkspace(summary) {
    if (summary.id === this._store.library.active_workspace_id) {
      this._toast.add_toast(new Adw.Toast({title: 'Switch to another workspace before archiving this one'}));
      return;
    }
    const dialog = new Adw.AlertDialog({
      heading: `Archive ${summary.name}?`,
      body: 'The workspace will disappear from the switcher, but its configuration remains stored locally and can be restored from Manage Workspaces.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('archive', 'Archive');
    dialog.set_response_appearance('archive', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'archive')
        return;
      try {
        await this._store.setWorkspaceArchived(summary.id, true);
        this._refreshWorkspaceView(this._currentPage);
        this._toast.add_toast(new Adw.Toast({title: `${summary.name} archived`}));
      } catch (error) {
        this._showError('Workspace could not be archived', error);
      }
    });
    dialog.present(this);
  }

  async _unarchiveWorkspace(summary) {
    try {
      await this._store.setWorkspaceArchived(summary.id, false);
      this._refreshWorkspaceView(this._currentPage);
      this._toast.add_toast(new Adw.Toast({title: `${summary.name} restored`}));
    } catch (error) {
      this._showError('Workspace could not be restored', error);
    }
  }

  _deleteWorkspace(summary) {
    if (!summary.archived) {
      this._toast.add_toast(new Adw.Toast({title: 'Archive this workspace before deleting it'}));
      return;
    }
    const dialog = new Adw.AlertDialog({
      heading: `Delete ${summary.name}?`,
      body: 'This removes the workspace from Workspace Hub. A local JSON safety copy is kept in the deleted-workspaces folder for future recovery.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('delete', 'Delete Workspace');
    dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'delete')
        return;
      try {
        await this._store.removeWorkspace(summary.id);
        this._refreshWorkspaceView(this._currentPage);
        this._toast.add_toast(new Adw.Toast({title: `${summary.name} deleted`}));
      } catch (error) {
        this._showError('Workspace could not be deleted', error);
      }
    });
    dialog.present(this);
  }

  async _moveWorkspace(summary, direction) {
    try {
      await this._store.moveWorkspace(summary.id, direction);
      this._refreshWorkspaceView(this._currentPage);
      this._toast.add_toast(new Adw.Toast({title: 'Workspace order updated'}));
    } catch (error) {
      this._showError('Workspace could not be moved', error);
    }
  }

  _closeWorkspaceManager(afterClosed = null) {
    if (!this._workspaceManagerDialog) {
      if (afterClosed)
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          afterClosed();
          return GLib.SOURCE_REMOVE;
        });
      return;
    }
    const dialog = this._workspaceManagerDialog;
    this._workspaceManagerDialog = null;
    if (afterClosed)
      this._afterDialogClosed(dialog, afterClosed);
    dialog.close();
  }

  _workspaceManagementMenu(summary, sameGroup, index) {
    const group = new Gio.SimpleActionGroup();
    const isActive = summary.id === this._store.library.active_workspace_id;
    const canCopyContents = !summary.archived
      && this._store.getWorkspaceContentsCopyDestinations(summary.id).length > 0;
    this._addMenuAction(group, 'activate', () => this._closeWorkspaceManager(() => this._activateWorkspace(summary.id)), !summary.archived && !isActive);
    this._addMenuAction(group, 'rename', () => this._closeWorkspaceManager(() => this._renameWorkspace(summary)));
    this._addMenuAction(group, 'duplicate', () => this._closeWorkspaceManager(() => this._duplicateWorkspace(summary)), !summary.archived);
    this._addMenuAction(group, 'copy-contents', () => this._closeWorkspaceManager(() => this._copyWorkspaceContents(summary)), canCopyContents);
    this._addMenuAction(group, 'move-earlier', () => this._closeWorkspaceManager(() => this._moveWorkspace(summary, 'up')), index > 0);
    this._addMenuAction(group, 'move-later', () => this._closeWorkspaceManager(() => this._moveWorkspace(summary, 'down')), index < sameGroup.length - 1);
    this._addMenuAction(group, 'archive', () => this._closeWorkspaceManager(() => this._archiveWorkspace(summary)), !summary.archived && !isActive);
    this._addMenuAction(group, 'unarchive', () => this._closeWorkspaceManager(() => this._unarchiveWorkspace(summary)), summary.archived);
    this._addMenuAction(group, 'delete', () => this._closeWorkspaceManager(() => this._deleteWorkspace(summary)), summary.archived);

    const menu = new Gio.Menu();
    const primary = new Gio.Menu();
    if (!summary.archived)
      primary.append(this._t('activate_workspace'), 'workspace.activate');
    primary.append(this._t('rename_workspace'), 'workspace.rename');
    if (!summary.archived) {
      primary.append(this._t('duplicate_workspace'), 'workspace.duplicate');
      primary.append(this._t('copy_workspace_contents'), 'workspace.copy-contents');
    }
    menu.append_section(null, primary);

    const ordering = new Gio.Menu();
    ordering.append(this._t('move_workspace_earlier'), 'workspace.move-earlier');
    ordering.append(this._t('move_workspace_later'), 'workspace.move-later');
    menu.append_section(null, ordering);

    const lifecycle = new Gio.Menu();
    if (summary.archived) {
      lifecycle.append(this._t('unarchive_workspace'), 'workspace.unarchive');
      lifecycle.append(this._t('delete_workspace'), 'workspace.delete');
    } else {
      lifecycle.append(this._t('archive_workspace'), 'workspace.archive');
    }
    menu.append_section(null, lifecycle);

    const popover = new Gtk.PopoverMenu({menu_model: menu});
    popover.insert_action_group('workspace', group);
    return new Gtk.MenuButton({
      icon_name: 'view-more-symbolic',
      popover,
      valign: Gtk.Align.CENTER,
      tooltip_text: this._t('manage_workspaces'),
    });
  }

  _workspaceManagerGroup(title, summaries) {
    const group = new Adw.PreferencesGroup({title});
    for (const [index, summary] of summaries.entries()) {
      const row = this._plainActionRow(summary.name, this._workspaceSubtitle(summary));
      if (summary.id === this._store.library.active_workspace_id) {
        row.add_prefix(new Gtk.Image({icon_name: 'object-select-symbolic'}));
        row.set_subtitle(`${this._t('active_workspace')} · ${this._workspaceSubtitle(summary)}`);
      }
      row.add_suffix(this._workspaceManagementMenu(summary, summaries, index));
      group.add(row);
    }
    return group;
  }

  _showWorkspaceManager() {
    const summaries = this._store.listWorkspaces();
    const available = summaries.filter(summary => !summary.archived);
    const archived = summaries.filter(summary => summary.archived);
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      margin_top: 6,
      margin_bottom: 6,
    });
    content.append(this._workspaceManagerGroup(this._t('workspace_switcher'), available));
    if (archived.length > 0)
      content.append(this._workspaceManagerGroup(this._t('archived_workspaces'), archived));
    else
      content.append(new Adw.PreferencesGroup({
        title: this._t('archived_workspaces'),
        description: this._t('no_archived_workspaces'),
      }));

    const scroller = new Gtk.ScrolledWindow({
      min_content_width: 420,
      min_content_height: 280,
      max_content_height: 520,
      propagate_natural_height: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      child: content,
    });
    const dialog = new Adw.AlertDialog({
      heading: this._t('manage_workspaces'),
      body: 'Create, switch, duplicate, reorder and archive independent dashboards.',
    });
    dialog.set_extra_child(scroller);
    this._workspaceManagerDialog = dialog;
    dialog.add_response('close', 'Close');
    dialog.add_response('create', this._t('create_workspace'));
    dialog.set_response_appearance('create', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_close_response('close');
    let createAfterClose = false;
    dialog.connect('response', (_dialog, response) => {
      this._workspaceManagerDialog = null;
      createAfterClose = response === 'create';
    });
    this._afterDialogClosed(dialog, () => {
      if (createAfterClose)
        this._createWorkspace();
    });
    dialog.present(this);
  }

  _buildWorkspaceSwitcher() {
    const summaries = this._store.listWorkspaces().filter(summary => !summary.archived);
    const active = summaries.find(summary => summary.id === this._store.library.active_workspace_id) ?? summaries[0];
    const popover = new Gtk.Popover({autohide: true, has_arrow: true});

    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 10,
      margin_top: 12,
      margin_bottom: 12,
      margin_start: 12,
      margin_end: 12,
      width_request: 300,
    });
    content.append(new Gtk.Label({
      label: this._t('workspace_switcher'),
      xalign: 0,
      css_classes: ['heading'],
    }));

    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
    list.connect('row-activated', (_list, row) => {
      popover.popdown();
      this._activateWorkspace(row._workspaceId);
    });
    for (const summary of summaries) {
      const row = this._plainActionRow(summary.name, this._workspaceSubtitle(summary), {activatable: true});
      row._workspaceId = summary.id;
      if (summary.id === this._store.library.active_workspace_id)
        row.add_suffix(new Gtk.Image({icon_name: 'object-select-symbolic'}));
      list.append(row);
    }
    content.append(list);
    content.append(new Gtk.Separator({orientation: Gtk.Orientation.HORIZONTAL}));

    const actions = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, homogeneous: true});
    const createButton = new Gtk.Button({label: this._t('create_workspace')});
    createButton.connect('clicked', () => {
      popover.popdown();
      this._createWorkspace();
    });
    const manageButton = new Gtk.Button({label: this._t('manage_workspaces')});
    manageButton.connect('clicked', () => {
      popover.popdown();
      this._showWorkspaceManager();
    });
    actions.append(createButton);
    actions.append(manageButton);
    content.append(actions);
    popover.set_child(content);

    const buttonContent = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10});
    buttonContent.append(new Gtk.Image({icon_name: 'folder-symbolic'}));
    const labels = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 1, hexpand: true});
    const activeLabel = new Gtk.Label({
      label: active?.name ?? 'Workspace',
      xalign: 0,
      ellipsize: Pango.EllipsizeMode.END,
      css_classes: ['heading'],
    });
    labels.append(activeLabel);
    labels.append(new Gtk.Label({
      label: active ? this._workspaceSubtitle(active) : '',
      xalign: 0,
      ellipsize: Pango.EllipsizeMode.END,
      css_classes: ['caption', 'dim-label'],
    }));
    buttonContent.append(labels);
    const pendingSpinner = new Gtk.Spinner({
      visible: this._workspaceActivationPending,
      spinning: this._workspaceActivationPending,
      valign: Gtk.Align.CENTER,
    });
    buttonContent.append(pendingSpinner);
    buttonContent.append(new Gtk.Image({icon_name: 'pan-down-symbolic'}));

    const button = new Gtk.MenuButton({
      popover,
      hexpand: true,
      css_classes: ['flat'],
      tooltip_text: this._t('workspace_switcher'),
    });
    button.set_child(buttonContent);
    button._activeWorkspaceId = active?.id ?? null;
    this._workspaceSwitcherButton = button;
    this._workspaceSwitcherTitleLabel = activeLabel;
    this._workspaceActivationPendingSpinner = pendingSpinner;
    return button;
  }

  _rebuildSidebar() {
    this._sidebarRows = new Map();
    this._sidebarLists = [];
    this._split.set_sidebar(new Adw.NavigationPage({title: 'Workspace Hub', child: this._buildSidebar()}));
    this._selectSidebarPage(this._currentPage);
  }

  _buildSidebar() {
    const view = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    header.set_title_widget(new Adw.WindowTitle({
      title: 'Workspace Hub',
      subtitle: this._t('subtitle'),
    }));
    view.add_top_bar(header);

    const menu = new Gio.Menu();
    menu.append('About Workspace Hub', 'app.about');
    menu.append('Quit', 'app.quit');
    header.pack_end(new Gtk.MenuButton({icon_name: 'open-menu-symbolic', menu_model: menu}));

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 16,
      margin_top: 16,
      margin_bottom: 16,
      margin_start: 12,
      margin_end: 12,
    });

    box.append(this._buildWorkspaceSwitcher());

    const sections = [
      [this._t('dashboard'), [[this._t('overview'), 'view-grid-symbolic', 'overview']]],
      [this._t('workspace'), [
        [this._t('apps'), 'view-app-grid-symbolic', 'apps'],
        [this._t('web_apps'), 'web-browser-symbolic', 'web_apps'],
        [this._t('files_places'), 'folder-symbolic', 'files_places'],
        [this._t('daily_tools'), 'applications-utilities-symbolic', 'daily_tools'],
      ]],
      [this._t('support'), [
        [this._t('help_support'), 'help-browser-symbolic', 'help_support'],
        [this._t('workspace_status'), 'security-high-symbolic', 'workspace_status'],
        [this._t('settings'), 'emblem-system-symbolic', 'settings'],
      ]],
    ];

    for (const [sectionTitle, items] of sections) {
      box.append(new Gtk.Label({
        label: sectionTitle,
        xalign: 0,
        css_classes: ['caption', 'dim-label'],
        margin_start: 6,
      }));

      const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, css_classes: ['navigation-sidebar']});
      this._sidebarLists.push(list);
      list.connect('row-activated', (_list, row) => {
        for (const other of this._sidebarLists) {
          if (other !== list)
            other.unselect_all();
        }
        this._navigate(row._pageId);
      });

      for (const [title, iconName, pageId] of items) {
        const row = this._plainActionRow(title, '', {activatable: true});
        row.add_prefix(new Gtk.Image({icon_name: iconName}));
        row._pageId = pageId;
        list.append(row);
        this._sidebarRows.set(pageId, {list, row});
      }
      box.append(list);
    }

    const scroller = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true});
    scroller.set_child(box);
    view.set_content(scroller);
    this._selectSidebarPage('overview');
    return view;
  }

  _selectSidebarPage(pageId) {
    for (const list of this._sidebarLists)
      list.unselect_all();
    const target = this._sidebarRows.get(pageId);
    if (target)
      target.list.select_row(target.row);
  }

  _disposeSectionNotebookControllers() {
    for (const controller of this._sectionNotebookControllers) {
      disposeSectionController(controller);
      controller.childrenById?.clear();
      controller.tabIdsByChild?.clear();
      controller.tabWidgetsByChild?.clear();
      controller.tabLabelsById?.clear();
      controller.pageFactory = null;
      controller.notebook = null;
    }
    this._sectionNotebookControllers.clear();
  }

  _beginViewGeneration() {
    this._disposeSectionNotebookControllers();
    this._viewGeneration += 1;
  }

  _navigate(pageId) {
    if (!PAGE_TITLE_KEYS[pageId])
      return;
    this._currentPage = pageId;
    this._selectSidebarPage(pageId);
    this._adaptiveGrids = [];
    this._beginViewGeneration();
    this._contentPage.set_child(this._buildPage(pageId));
    this._contentPage.set_title(this._pageMeta(pageId)[0]);
    this._split.set_show_content(true);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._updateLayout();
      return GLib.SOURCE_REMOVE;
    });
  }

  _buildPage(pageId) {
    let page;
    if (pageId === 'overview')
      page = this._buildOverview();
    else if (pageId === 'settings')
      page = this._buildSettings();
    else if (pageId === 'workspace_status')
      page = this._buildWorkspaceStatus();
    else
      page = this._buildCollectionPage(pageId);
    page._workspaceId = this._profile.profile.id;
    page._pageId = pageId;
    return page;
  }

  _pageShell(windowTitle, windowSubtitle, content, {title = null, description = null} = {}) {
    const view = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    header.set_title_widget(new Adw.WindowTitle({title: windowTitle, subtitle: windowSubtitle}));
    view.add_top_bar(header);

    const page = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 24,
      css_classes: ['workspace-page'],
    });

    if (title) {
      const intro = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
      intro.append(new Gtk.Label({label: title, xalign: 0, wrap: true, css_classes: ['title-1']}));
      if (description)
        intro.append(new Gtk.Label({label: description, xalign: 0, wrap: true, css_classes: ['dim-label']}));
      page.append(intro);
    }
    page.append(content);

    const clamp = new Adw.Clamp({
      maximum_size: PAGE_WIDTH,
      tightening_threshold: 760,
      margin_top: 28,
      margin_bottom: 24,
      margin_start: 18,
      margin_end: 18,
      child: page,
    });

    view.set_content(new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      child: clamp,
    }));
    return view;
  }

  _buildOverview() {
    const profile = this._profile;
    const summary = profileSummary(profile);
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 22});

    const greeting = profile.settings.greeting_name?.trim() || 'there';
    const intro = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
    intro.append(new Gtk.Label({label: this._t('greeting', {name:greeting}), xalign: 0, wrap: true, css_classes: ['title-1']}));
    intro.append(new Gtk.Label({
      label: this._t('intro'),
      xalign: 0,
      wrap: true,
      css_classes: ['dim-label'],
    }));
    content.append(intro);

    if (profile.settings.show_attention_banner !== false) {
      const attention = this._attentionBanner();
      if (attention)
        content.append(attention);
    }

    const metrics = [
      ['apps', this._t('apps'), String(summary.apps), this._t('configured'), 'accent'],
      ['web_apps', this._t('web_apps'), String(summary.webApps), this._t('configured'), 'status-info'],
      ['files_places', this._t('files_places'), String(summary.places), this._t('configured'), 'status-info'],
      ['support', this._t('support'), String(summary.supportActions), this._t('configured'), 'status-info'],
    ];
    const metricGrid = new Gtk.Grid({column_spacing: 10, row_spacing: 10, column_homogeneous: true});
    const metricCards = metrics.map(item => this._summaryCard(...item));
    content.append(metricGrid);
    this._adaptiveGrids.push({grid: metricGrid, children: metricCards, type: 'metrics'});

    const sectionGrid = new Gtk.Grid({column_spacing: 12, row_spacing: 12, column_homogeneous: false});
    const visibility = profile.settings.section_visibility;
    const panels = [
      {key:'apps', enabled:visibility.apps, widget:this._dashboardPanel(this._t('start_work'), this._t('start_work_help'), this._dashboardTabbedBody('apps', 3), {sectionName:'apps'})},
      {key:'web', enabled:visibility.web_apps, widget:this._dashboardPanel(this._t('web_heading'), this._t('web_help'), this._dashboardTabbedBody('web_apps', 2), {sectionName:'web_apps'})},
      {key:'places', enabled:visibility.files_places, widget:this._dashboardPanel(this._t('places_heading'), this._t('places_help'), this._dashboardTabbedBody('files_places', 3), {sectionName:'files_places'})},
      {key:'status', enabled:visibility.workspace_status, widget:this._dashboardPanel(this._t('status_heading'), this._t('status_help'), this._statusList(this._workspaceStatusItems()))},
      {key:'support', enabled:visibility.help_support, widget:this._dashboardPanel(this._t('support_heading'), this._t('support_help'), this._supportList(profile.sections.help_support))},
    ].filter(panel => panel.enabled);
    content.append(sectionGrid);
    this._adaptiveGrids.push({grid: sectionGrid, children: panels, type: 'sections'});

    content.append(this._footer());
    this._attachDashboardBackgroundContextMenu(content);
    const [overviewTitle, overviewSubtitle] = this._pageMeta('overview');
    const view = this._pageShell(overviewTitle, overviewSubtitle, content);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._updateLayout();
      return GLib.SOURCE_REMOVE;
    });
    return view;
  }

  _attentionBanner() {
    const summary = this._diagnostics.summary;
    let title = '';
    let message = '';
    if (summary.attention > 0) {
      title = `${summary.attention} item${summary.attention === 1 ? '' : 's'} need attention`;
      const first = this._diagnostics.checks.find(check => !['available', 'valid', 'supported', 'remote-available', 'not-checked'].includes(check.status));
      message = first ? `${first.title}: ${first.detail}` : 'Review workspace diagnostics';
    } else if (this._profile.profile.source === 'example') {
      title = this._profile.settings.attention_title || 'Example workspace active';
      message = this._profile.settings.attention_message || 'Review sample items before deployment';
    } else if (summary.notChecked > 0) {
      title = `${summary.notChecked} shared location${summary.notChecked === 1 ? '' : 's'} not checked`;
      message = 'Remote reachability is intentionally checked only on request';
    } else {
      return null;
    }

    const banner = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, css_classes: ['attention-banner']});
    banner.append(new Gtk.Image({icon_name: summary.attention > 0 ? 'dialog-warning-symbolic' : 'dialog-information-symbolic', css_classes: [summary.attention > 0 ? 'status-warning' : 'status-info']}));
    const labels = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true});
    labels.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']}));
    labels.append(new Gtk.Label({label: message, xalign: 0, wrap: true, hexpand: true, css_classes: ['dim-label']}));
    banner.append(labels);
    const review = new Gtk.Button({label: 'Review now', valign: Gtk.Align.CENTER});
    review.connect('clicked', () => this._navigate('workspace_status'));
    banner.append(review);
    return banner;
  }

  _summaryCard(summaryId, title, value, subtitle, stateClass) {
    const card = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 14, hexpand: true, css_classes: ['summary-card']});
    const summaryIcon = this._namedDashboardIcon(
      resolveSummaryIcon(summaryId, this._profile.settings.icon_style),
      'summary-icon',
      28
    );
    card.append(this._dashboardIconFrame(summaryIcon, 48, ['summary-icon-container', stateClass]));
    const text = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 2,
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    text.append(new Gtk.Label({label: title, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']}));
    const valueLine = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, valign: Gtk.Align.CENTER});
    valueLine.append(new Gtk.Label({label: value, xalign: 0, valign: Gtk.Align.CENTER, css_classes: ['summary-value']}));
    valueLine.append(new Gtk.Label({label: subtitle, xalign: 0, valign: Gtk.Align.CENTER, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption', 'dim-label']}));
    text.append(valueLine);
    card.append(text);
    return card;
  }

  _isTabbedSection(sectionName) {
    return TABBED_SECTION_NAMES.includes(sectionName);
  }

  async _persistSectionTabSelection(sectionName, tabId) {
    if (!this._isTabbedSection(sectionName) || activeSectionTabId(this._profile, sectionName) === tabId)
      return;
    try {
      const next = setActiveSectionTab(this._profile, sectionName, tabId);
      this._profile = await this._store.saveViewState(next);
    } catch (error) {
      this._showError('The selected tab could not be remembered', error);
    }
  }

  _sectionControllerExpectation(sectionName, pageId = this._currentPage, workspaceId = null) {
    return {
      workspaceId: workspaceId ?? this._store.getWorkspaceLibrarySummary().activeWorkspaceId,
      pageId,
      sectionName,
      generation: this._viewGeneration,
    };
  }

  _isLiveSectionNotebookController(controller, expected = null) {
    const identity = expected ?? this._sectionControllerExpectation(
      controller?.sectionName,
      controller?.pageId ?? this._currentPage,
      controller?.workspaceId ?? null
    );
    return Boolean(
      controller?.notebook
      && this._sectionNotebookControllers.has(controller)
      && sectionControllerMatches(controller, identity)
      && controller.notebook.get_root() === this
    );
  }

  _findLiveSectionNotebookController({workspaceId, pageId, sectionName}) {
    const expected = this._sectionControllerExpectation(sectionName, pageId, workspaceId);
    for (const controller of this._sectionNotebookControllers) {
      if (this._isLiveSectionNotebookController(controller, expected))
        return controller;
    }
    return null;
  }

  _configureSectionTabLabel(label, title) {
    const displayTitle = String(title ?? '');
    label.set_label(displayTitle);
    label.set_tooltip_text(displayTitle);
    label.set_ellipsize(Pango.EllipsizeMode.NONE);
    label.set_width_chars(-1);
    label.set_max_width_chars(-1);
    if (Array.from(displayTitle).length > SECTION_TAB_TITLE_MAX_CHARS) {
      label.set_ellipsize(Pango.EllipsizeMode.END);
      label.set_width_chars(SECTION_TAB_TITLE_MAX_CHARS);
      label.set_max_width_chars(SECTION_TAB_TITLE_MAX_CHARS);
    }
  }

  _appendSectionTabPage(controller, tab, position = -1) {
    const child = controller.pageFactory(tab.id, controller);
    const displayTitle = sectionTabDisplayTitle(tab, key => this._t(key));
    const tabLabel = new Gtk.Label({
      xalign: 0.5,
      single_line_mode: true,
      css_classes: ['section-tab-label'],
    });
    this._configureSectionTabLabel(tabLabel, displayTitle);

    const tabWidget = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      css_classes: ['section-tab-widget'],
    });
    tabWidget.append(tabLabel);

    if (position >= 0)
      controller.notebook.insert_page(child, tabWidget, position);
    else
      controller.notebook.append_page(child, tabWidget);

    this._attachSectionTabContextMenu(tabWidget, controller, tab.id);
    controller.notebook.set_tab_reorderable(child, true);
    controller.notebook.set_tab_detachable(child, false);
    controller.childrenById.set(tab.id, child);
    controller.tabIdsByChild.set(child, tab.id);
    controller.tabWidgetsByChild.set(child, tabWidget);
    controller.tabLabelsById.set(tab.id, tabLabel);
    return child;
  }

  _removeSectionTabPage(controller, tabId) {
    const child = controller.childrenById.get(tabId);
    if (!child)
      return false;
    const page = controller.notebook.page_num(child);
    if (page < 0)
      return false;
    controller.notebook.remove_page(page);
    controller.childrenById.delete(tabId);
    controller.tabIdsByChild.delete(child);
    controller.tabWidgetsByChild.delete(child);
    controller.tabLabelsById.delete(tabId);
    return true;
  }

  _replaceSectionTabPageContent(controller, tabId) {
    const oldChild = controller.childrenById.get(tabId);
    const tab = sectionTabs(this._profile, controller.sectionName).find(entry => entry.id === tabId);
    if (!oldChild || !tab)
      return false;
    const page = controller.notebook.page_num(oldChild);
    if (page < 0)
      return false;
    this._removeSectionTabPage(controller, tabId);
    this._appendSectionTabPage(controller, tab, page);
    return true;
  }

  _selectSectionTabInNotebook(controller, tabId) {
    const child = controller.childrenById.get(tabId);
    if (!child)
      return;
    const page = controller.notebook.page_num(child);
    if (page >= 0)
      controller.notebook.set_current_page(page);
  }

  _showAddSectionTabDialog(sectionName, returnPage = this._currentPage, controller = null) {
    if (!this._isTabbedSection(sectionName))
      return;
    const sectionTitle = this._pageMeta(sectionName)[0];
    const dialog = new Adw.AlertDialog({
      heading: this._t('add_tab'),
      body: this._t('add_tab_body', {section: sectionTitle}),
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('add', this._t('add_tab'));
    dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('add');
    dialog.set_close_response('cancel');
    const {field, entry} = this._singleLineNameField({
      dialog,
      label: this._t('tab_name'),
      responseId: 'add',
    });
    dialog.set_extra_child(field);
    let confirmedTitle = null;
    dialog.connect('response', (_dialog, response) => {
      if (response !== 'add')
        return;
      const title = entry.get_text().trim();
      if (!title) {
        this._toast.add_toast(new Adw.Toast({title: this._t('tab_name_required')}));
        return;
      }
      confirmedTitle = title;
    });
    this._afterDialogClosed(dialog, async () => {
      if (confirmedTitle === null)
        return;
      try {
        const next = addSectionTab(this._profile, sectionName, confirmedTitle);
        await this._store.save(next, {
          action: 'section-tab-added',
          summary: `Added ${confirmedTitle} tab to ${sectionTitle}`,
          details: {section: sectionName, tab_title: confirmedTitle},
        });
        this._profile = this._store.profile;
        this._toast.add_toast(new Adw.Toast({title: this._t('tab_added', {name: confirmedTitle})}));

        if (this._isLiveSectionNotebookController(controller)) {
          const activeId = activeSectionTabId(this._profile, sectionName);
          const tab = sectionTabs(this._profile, sectionName).find(entry => entry.id === activeId);
          if (!tab)
            throw new Error('The newly created tab could not be found');
          controller.suppressSignals = true;
          try {
            this._appendSectionTabPage(controller, tab);
            this._selectSectionTabInNotebook(controller, tab.id);
          } finally {
            controller.suppressSignals = false;
          }
        } else {
          this._navigate(returnPage || sectionName);
        }
      } catch (error) {
        this._showError('The tab could not be added', error);
      }
    });
    dialog.present(this);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      entry.grab_focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  _showRenameSectionTabDialog(sectionName, tabId, returnPage = this._currentPage, controller = null) {
    const tab = sectionTabs(this._profile, sectionName).find(entry => entry.id === tabId);
    if (!tab)
      return;
    const currentTitle = sectionTabDisplayTitle(tab, key => this._t(key));
    const dialog = new Adw.AlertDialog({
      heading: this._t('rename_tab'),
      body: this._t('rename_tab_body', {section: this._pageMeta(sectionName)[0]}),
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('rename', this._t('rename_tab'));
    dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('rename');
    dialog.set_close_response('cancel');
    const {field, entry} = this._singleLineNameField({
      dialog,
      label: this._t('tab_name'),
      initialText: currentTitle,
      responseId: 'rename',
      unchangedText: currentTitle,
    });
    dialog.set_extra_child(field);
    let confirmedTitle = null;
    dialog.connect('response', (_dialog, response) => {
      if (response !== 'rename')
        return;
      const title = entry.get_text().trim();
      if (title === currentTitle)
        return;
      if (!title) {
        this._toast.add_toast(new Adw.Toast({title: this._t('tab_name_required')}));
        return;
      }
      confirmedTitle = title;
    });
    this._afterDialogClosed(dialog, async () => {
      if (confirmedTitle === null)
        return;
      try {
        const next = renameSectionTab(this._profile, sectionName, tabId, confirmedTitle);
        await this._store.save(next, {
          action: 'section-tab-renamed',
          summary: `Renamed ${currentTitle} tab to ${confirmedTitle}`,
          details: {section: sectionName, tab_id: tabId, previous_title: currentTitle, tab_title: confirmedTitle},
        });
        this._profile = this._store.profile;
        this._toast.add_toast(new Adw.Toast({title: this._t('tab_renamed', {name: confirmedTitle})}));

        if (this._isLiveSectionNotebookController(controller)) {
          const updatedTab = sectionTabs(this._profile, sectionName).find(entry => entry.id === tabId);
          const label = controller.tabLabelsById.get(tabId);
          if (!updatedTab || !label)
            throw new Error('The live tab label could not be found');
          this._configureSectionTabLabel(label, sectionTabDisplayTitle(updatedTab, key => this._t(key)));
        } else {
          this._navigate(returnPage || sectionName);
        }
      } catch (error) {
        this._showError('The tab could not be renamed', error);
      }
    });
    dialog.present(this);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      entry.grab_focus();
      entry.select_region(0, -1);
      return GLib.SOURCE_REMOVE;
    });
  }

  async _moveSectionTab(sectionName, tabId, direction, returnPage = this._currentPage, controller = null) {
    try {
      const next = moveSectionTab(this._profile, sectionName, tabId, direction);
      await this._store.save(next, {
        action: 'section-tab-moved',
        summary: `Moved a tab ${direction} in ${this._pageMeta(sectionName)[0]}`,
        details: {section: sectionName, tab_id: tabId, direction},
      });
      this._profile = this._store.profile;
      this._toast.add_toast(new Adw.Toast({title: this._t('tab_order_updated')}));

      if (this._isLiveSectionNotebookController(controller)) {
        const child = controller.childrenById.get(tabId);
        const targetIndex = sectionTabs(this._profile, sectionName).findIndex(entry => entry.id === tabId);
        if (!child || targetIndex < 0)
          throw new Error('The live tab page could not be found');
        controller.suppressSignals = true;
        try {
          controller.notebook.reorder_child(child, targetIndex);
        } finally {
          controller.suppressSignals = false;
        }
      } else {
        this._navigate(returnPage || sectionName);
      }
    } catch (error) {
      this._showError('The tab could not be moved', error);
    }
  }

  async _deleteSectionTab(sectionName, tabId, moveItemsToTabId, returnPage, controller = null) {
    const tab = sectionTabs(this._profile, sectionName).find(entry => entry.id === tabId);
    if (!tab)
      return;
    const displayTitle = sectionTabDisplayTitle(tab, key => this._t(key));
    try {
      const next = removeSectionTab(this._profile, sectionName, tabId, {moveItemsToTabId});
      await this._store.save(next, {
        action: 'section-tab-deleted',
        summary: `Deleted ${displayTitle} tab from ${this._pageMeta(sectionName)[0]}`,
        details: {section: sectionName, tab_id: tabId, moved_items_to_tab_id: moveItemsToTabId || null},
      });
      this._profile = this._store.profile;
      this._toast.add_toast(new Adw.Toast({title: this._t('tab_deleted', {name: displayTitle})}));

      if (this._isLiveSectionNotebookController(controller)) {
        controller.suppressSignals = true;
        try {
          if (!this._removeSectionTabPage(controller, tabId))
            throw new Error('The live tab page could not be removed');
          if (moveItemsToTabId && !this._replaceSectionTabPageContent(controller, moveItemsToTabId))
            throw new Error('The destination tab could not be refreshed');
          this._selectSectionTabInNotebook(controller, activeSectionTabId(this._profile, sectionName));
        } finally {
          controller.suppressSignals = false;
        }
      } else {
        this._navigate(returnPage || sectionName);
      }
    } catch (error) {
      this._showError('The tab could not be deleted', error);
    }
  }

  _confirmRemoveSectionTab(sectionName, tabId, returnPage = this._currentPage, controller = null) {
    const tabs = sectionTabs(this._profile, sectionName);
    const tab = tabs.find(entry => entry.id === tabId);
    if (!tab)
      return;
    if (tab.is_default) {
      this._toast.add_toast(new Adw.Toast({title: this._t('default_tab_protected')}));
      return;
    }
    const displayTitle = sectionTabDisplayTitle(tab, key => this._t(key));
    const items = sectionItemsForTab(this._profile, sectionName, tabId);
    const dialog = new Adw.AlertDialog({
      heading: this._t('delete_tab_heading', {name: displayTitle}),
      body: items.length > 0
        ? this._t('delete_nonempty_tab_body', {count: items.length})
        : this._t('delete_empty_tab_body'),
    });

    let destinationRow = null;
    let destinations = [];
    if (items.length > 0) {
      destinations = tabs.filter(entry => entry.id !== tabId);
      const model = Gtk.StringList.new(destinations.map(entry => sectionTabDisplayTitle(entry, key => this._t(key))));
      destinationRow = new Adw.ComboRow({
        title: this._t('move_items_to_tab'),
        model,
        selected: 0,
      });
      const group = new Adw.PreferencesGroup();
      group.add(destinationRow);
      dialog.set_extra_child(group);
    }

    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('delete', this._t('delete_tab'));
    dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    let confirmedDestinationTabId = undefined;
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'delete')
        return;
      confirmedDestinationTabId = destinationRow ? destinations[destinationRow.get_selected()]?.id : null;
    });
    this._afterDialogClosed(dialog, () => {
      if (confirmedDestinationTabId === undefined)
        return;
      this._deleteSectionTab(sectionName, tabId, confirmedDestinationTabId, returnPage, controller);
    });
    dialog.present(this);
  }

  _openSectionTabContextMenu(widget, controller, tabId, x, y) {
    const {sectionName, returnPage} = controller;
    const tabs = sectionTabs(this._profile, sectionName);
    const index = tabs.findIndex(tab => tab.id === tabId);
    const tab = tabs[index];
    if (!tab)
      return;

    const group = new Gio.SimpleActionGroup();
    this._addMenuAction(group, 'rename', () => this._showRenameSectionTabDialog(sectionName, tabId, returnPage, controller));
    this._addMenuAction(group, 'move-earlier', () => this._moveSectionTab(sectionName, tabId, 'earlier', returnPage, controller), index > 0);
    this._addMenuAction(group, 'move-later', () => this._moveSectionTab(sectionName, tabId, 'later', returnPage, controller), index >= 0 && index < tabs.length - 1);
    this._addMenuAction(group, 'delete', () => this._confirmRemoveSectionTab(sectionName, tabId, returnPage, controller), tabs.length > 1 && !tab.is_default);

    const menu = new Gio.Menu();
    const primary = new Gio.Menu();
    primary.append(this._t('rename_tab'), 'section-tab.rename');
    menu.append_section(null, primary);
    const ordering = new Gio.Menu();
    ordering.append(this._t('context_move_earlier'), 'section-tab.move-earlier');
    ordering.append(this._t('context_move_later'), 'section-tab.move-later');
    menu.append_section(null, ordering);
    const destructive = new Gio.Menu();
    destructive.append(this._t('delete_tab'), 'section-tab.delete');
    menu.append_section(null, destructive);
    this._popupMenu(widget, menu, group, 'section-tab', x, y);
  }

  _attachSectionTabContextMenu(widget, controller, tabId) {
    const secondaryClick = new Gtk.GestureClick({button: Gdk.BUTTON_SECONDARY});
    secondaryClick.connect('pressed', (gesture, _pressCount, x, y) => {
      gesture.set_state(Gtk.EventSequenceState.CLAIMED);
      const child = controller.childrenById.get(tabId);
      const page = child ? controller.notebook.page_num(child) : -1;
      if (page >= 0)
        controller.notebook.set_current_page(page);
      this._openSectionTabContextMenu(widget, controller, tabId, x, y);
    });
    widget.add_controller(secondaryClick);
  }

  async _persistSectionTabOrder(controller) {
    if (controller.suppressSignals)
      return;
    const {sectionName, notebook, tabIdsByChild} = controller;
    const orderedIds = [];
    for (let index = 0; index < notebook.get_n_pages(); index += 1) {
      const child = notebook.get_nth_page(index);
      const tabId = tabIdsByChild.get(child);
      if (tabId)
        orderedIds.push(tabId);
    }
    try {
      const next = reorderSectionTabs(this._profile, sectionName, orderedIds);
      await this._store.save(next, {
        action: 'section-tabs-reordered',
        summary: `Reordered tabs in ${this._pageMeta(sectionName)[0]}`,
        details: {section: sectionName, tab_ids: orderedIds},
      });
      this._profile = this._store.profile;
    } catch (error) {
      this._showError('The tab order could not be saved', error);
      this._navigate(this._currentPage);
    }
  }

  _sectionNotebook(sectionName, pageFactory, returnPage = this._currentPage) {
    const notebook = new Gtk.Notebook();
    notebook.set_scrollable(true);
    notebook.set_show_tabs(true);
    notebook.set_show_border(false);
    notebook.set_hexpand(true);
    notebook.set_vexpand(false);
    notebook.add_css_class('section-notebook');

    const identity = createSectionControllerIdentity({
      workspaceId: this._store.getWorkspaceLibrarySummary().activeWorkspaceId,
      pageId: returnPage,
      sectionName,
      generation: this._viewGeneration,
    });
    const controller = {
      ...identity,
      returnPage,
      pageFactory,
      notebook,
      childrenById: new Map(),
      tabIdsByChild: new Map(),
      tabWidgetsByChild: new Map(),
      tabLabelsById: new Map(),
      suppressSignals: false,
      isDisposed: false,
    };
    this._sectionNotebookControllers.add(controller);

    for (const tab of sectionTabs(this._profile, sectionName))
      this._appendSectionTabPage(controller, tab);

    const selected = controller.childrenById.get(activeSectionTabId(this._profile, sectionName)) ?? controller.childrenById.values().next().value;
    if (selected)
      notebook.set_current_page(notebook.page_num(selected));

    notebook.connect('switch-page', (_notebook, child) => {
      if (controller.suppressSignals)
        return;
      const tabId = controller.tabIdsByChild.get(child);
      if (tabId)
        this._persistSectionTabSelection(sectionName, tabId);
    });
    notebook.connect('page-reordered', () => this._persistSectionTabOrder(controller));

    const keyboard = new Gtk.EventControllerKey();
    keyboard.connect('key-pressed', (_controller, keyval, _keycode, state) => {
      const keyboardMenu = keyval === Gdk.KEY_Menu;
      const shiftF10 = keyval === Gdk.KEY_F10 && Boolean(state & Gdk.ModifierType.SHIFT_MASK);
      if (!keyboardMenu && !shiftF10)
        return false;
      const page = notebook.get_current_page();
      const child = page >= 0 ? notebook.get_nth_page(page) : null;
      const tabId = child ? controller.tabIdsByChild.get(child) : null;
      const tabWidget = child ? controller.tabWidgetsByChild.get(child) : null;
      if (!tabId || !tabWidget)
        return false;
      this._openSectionTabContextMenu(tabWidget, controller, tabId, tabWidget.get_width() / 2, tabWidget.get_height() / 2);
      return true;
    });
    notebook.add_controller(keyboard);

    const addTabButton = new Gtk.Button({
      icon_name: 'list-add-symbolic',
      tooltip_text: this._t('add_tab_to_section', {section: this._pageMeta(sectionName)[0]}),
      css_classes: ['flat'],
      valign: Gtk.Align.CENTER,
    });
    addTabButton.connect('clicked', () => this._showAddSectionTabDialog(sectionName, returnPage, controller));
    notebook.set_action_widget(addTabButton, Gtk.PackType.END);
    return notebook;
  }

  _dashboardTabbedBody(sectionName, columns) {
    return this._sectionNotebook(
      sectionName,
      (tabId, controller) => this._tileGrid(sectionItemsForTab(this._profile, sectionName, tabId), columns, sectionName, controller),
      'overview',
    );
  }

  _dashboardPanel(title, helper, body, {sectionName = null, returnPage = 'overview'} = {}) {
    const panel = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, hexpand: true, vexpand: true, css_classes: ['dashboard-panel']});
    const header = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['dashboard-panel-header']});
    const titleLine = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10});
    titleLine.append(new Gtk.Label({label: title, xalign: 0, wrap: true, hexpand: true, css_classes: ['title-3']}));
    if (sectionName) {
      const addItem = new Gtk.Button({
        label: this._addLabel(sectionName),
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
      });
      addItem.connect('clicked', () => this._openTileEditor(sectionName, null, returnPage));
      titleLine.append(addItem);
    }
    header.append(titleLine);
    header.append(new Gtk.Label({label: helper || ' ', xalign: 0, wrap: true, css_classes: ['caption', 'dim-label', 'section-helper']}));
    panel.append(header);
    panel.append(body);
    return panel;
  }

  _tileGrid(items, columns, sectionName = null, controller = null) {
    const grid = new Gtk.Grid({column_spacing: 8, row_spacing: 8, column_homogeneous: true, hexpand: true});
    const visible = items.filter(item => item.enabled !== false).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (visible.length === 0)
      return this._emptyDashboardSection(sectionName);
    visible.forEach((item, index) => grid.attach(this._tile(item, sectionName, controller), index % columns, Math.floor(index / columns), 1, 1));
    return grid;
  }

  _emptyDashboardSection(sectionName) {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
      halign: Gtk.Align.START,
      valign: Gtk.Align.START,
      hexpand: false,
      vexpand: false,
      css_classes: ['dashboard-empty-state'],
    });
    box.append(new Gtk.Image({
      icon_name: 'list-add-symbolic',
      halign: Gtk.Align.START,
      css_classes: ['empty-state-icon', 'dim-label'],
    }));
    box.append(new Gtk.Label({
      label: 'Nothing configured yet',
      xalign: 0,
      css_classes: ['heading'],
    }));
    box.append(new Gtk.Label({
      label: 'Add an item to make this section useful.',
      wrap: true,
      max_width_chars: 32,
      xalign: 0,
      justify: Gtk.Justification.LEFT,
      css_classes: ['caption', 'dim-label'],
    }));
    if (sectionName) {
      const button = new Gtk.Button({label: this._addLabel(sectionName), halign: Gtk.Align.START});
      button.connect('clicked', () => this._navigate(sectionName));
      box.append(button);
    }
    return box;
  }

  _iconStyleClass() {
    return `icon-style-${normaliseIconStyle(this._profile.settings.icon_style)}`;
  }

  _dashboardIconFrame(icon, size, cssClasses = []) {
    const frame = new Gtk.CenterBox({
      width_request: size,
      height_request: size,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      css_classes: cssClasses,
    });
    frame.set_center_widget(icon);
    return frame;
  }

  _namedDashboardIcon(iconName, baseClass = 'tile-icon', pixelSize = 26) {
    return new Gtk.Image({
      icon_name: iconName || 'application-x-executable-symbolic',
      pixel_size: pixelSize,
      width_request: pixelSize,
      height_request: pixelSize,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      hexpand: false,
      vexpand: false,
      css_classes: [baseClass, this._iconStyleClass()],
    });
  }

  _applicationIcon(item, baseClass = 'tile-icon', pixelSize = 28) {
    const catalogApplication = this._appCatalog.resolveItem(item);
    const catalogIcon = this._appCatalog.iconFor(catalogApplication);
    if (catalogIcon) {
      return new Gtk.Image({
        gicon: catalogIcon,
        pixel_size: pixelSize,
        width_request: pixelSize,
        height_request: pixelSize,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: false,
        vexpand: false,
        css_classes: [baseClass, 'real-application-icon'],
      });
    }

    const makeImage = appInfo => {
      const gicon = appInfo?.get_icon();
      if (!gicon)
        return null;
      return new Gtk.Image({
        gicon,
        pixel_size: pixelSize,
        width_request: pixelSize,
        height_request: pixelSize,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: false,
        vexpand: false,
        css_classes: [baseClass, 'real-application-icon'],
      });
    };

    try {
      const exact = Gio.DesktopAppInfo.new(item.desktop_id);
      const exactImage = makeImage(exact);
      if (exactImage)
        return exactImage;

      const expectedIds = new Set([
        String(item.desktop_id ?? '').toLowerCase(),
        String(item.desktop_id ?? '').replace(/\.desktop$/i, '').toLowerCase(),
      ]);
      const expectedNames = [item.subtitle, item.title]
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase());
      for (const appInfo of Gio.AppInfo.get_all()) {
        const appId = String(appInfo.get_id?.() ?? '').toLowerCase();
        const appIdWithoutSuffix = appId.replace(/\.desktop$/i, '');
        const appName = String(appInfo.get_display_name?.() ?? appInfo.get_name?.() ?? '').trim().toLowerCase();
        if (expectedIds.has(appId) || expectedIds.has(appIdWithoutSuffix) || expectedNames.includes(appName)) {
          const image = makeImage(appInfo);
          if (image)
            return image;
        }
      }
    } catch (error) {
      console.debug(`[Workspace Hub] Could not resolve application icon for ${item.desktop_id}: ${error.message}`);
    }
    return null;
  }

  _applicationIconMode(item) {
    const override = item.icon_override || 'inherit';
    if (override === 'application' || override === 'dashboard')
      return override;
    return this._profile.settings.application_icon_policy === 'dashboard' ? 'dashboard' : 'application';
  }

  _dashboardItemIcon(item, baseClass = 'tile-icon', pixelSize = 28) {
    const style = normaliseIconStyle(this._profile.settings.icon_style);
    if (item.type === 'application' && this._applicationIconMode(item) === 'application') {
      const applicationIcon = this._applicationIcon(item, baseClass, pixelSize);
      if (applicationIcon)
        return applicationIcon;
    }

    const themedIcon = resolveTileIcon(item, style);
    if (themedIcon)
      return this._namedDashboardIcon(themedIcon, baseClass, pixelSize);

    if (item.type === 'application') {
      const applicationIcon = this._applicationIcon(item, baseClass, pixelSize);
      if (applicationIcon)
        return applicationIcon;
    }
    return this._namedDashboardIcon(item.icon_name || this._fallbackIcon(item.type), baseClass, pixelSize);
  }

  _diagnosticFor(item) {
    return this._diagnostics.checks.find(check => check.id === item.id) ?? null;
  }

  _diagnosticVisual(check) {
    if (!check)
      return {icon:'dialog-information-symbolic', css:'dim-label', label:'Not checked'};
    if (['available', 'supported', 'remote-available'].includes(check.status))
      return {icon:'emblem-ok-symbolic', css:'status-ok', label:check.detail};
    if (check.status === 'valid' || check.status === 'not-checked')
      return {icon:'dialog-information-symbolic', css:'status-info', label:check.detail};
    return {icon:'dialog-warning-symbolic', css:'status-warning', label:check.detail};
  }

  _dashboardDiagnosticVisual(check) {
    if (!check)
      return null;
    if (['available', 'supported', 'remote-available', 'valid'].includes(check.status))
      return null;
    if (check.status === 'not-checked')
      return {icon:'dialog-information-symbolic', css:'status-info', label:check.detail};
    return {icon:'dialog-warning-symbolic', css:'status-warning', label:check.detail};
  }

  _dashboardStatusVisual(state) {
    if (state === 'ok')
      return null;
    if (state === 'warning' || state === 'error')
      return {icon:'dialog-warning-symbolic', css:this._statusClass(state)};
    return {icon:'dialog-information-symbolic', css:this._statusClass(state)};
  }

  _tile(item, sectionName, controller = null) {
    const button = new Gtk.Button({hexpand: true, css_classes: ['flat', 'dashboard-tile']});
    const row = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 12});
    const tileIcon = this._dashboardItemIcon(item, 'tile-icon', 28);
    row.append(this._dashboardIconFrame(tileIcon, 44, ['tile-icon-container']));
    const labels = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true, valign: Gtk.Align.CENTER});
    labels.append(new Gtk.Label({label: item.title, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']}));
    if (item.subtitle)
      labels.append(new Gtk.Label({label: item.subtitle, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption', 'dim-label']}));
    row.append(labels);
    const health = this._dashboardDiagnosticVisual(this._diagnosticFor(item));
    if (health)
      row.append(new Gtk.Image({icon_name: health.icon, tooltip_text: health.label, css_classes: ['tile-health-icon', health.css]}));
    if (item.type === 'web')
      row.append(new Gtk.Image({icon_name: 'adw-external-link-symbolic', css_classes: ['external-indicator']}));
    else
      row.append(new Gtk.Image({icon_name: 'go-next-symbolic', css_classes: ['external-indicator']}));
    button.set_child(row);
    button.connect('clicked', () => this._activateItem(item));
    if (sectionName)
      this._attachTileContextMenu(button, sectionName, item, controller);
    return button;
  }

  _fallbackIcon(type) {
    return ({application:'application-x-executable-symbolic', web:'web-browser-symbolic', place:'folder-symbolic', action:'system-run-symbolic'})[type] || 'application-x-executable-symbolic';
  }

  _statusList(items) {
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['status-list']});
    for (const item of items) {
      const row = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, css_classes: ['status-row']});
      const statusIcon = this._namedDashboardIcon(
        resolveStatusIcon(item.id, item.icon_name, this._profile.settings.icon_style),
        'status-content-icon',
        20
      );
      row.append(this._dashboardIconFrame(statusIcon, 28, ['status-icon-container']));
      row.append(new Gtk.Label({label: item.title, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']}));
      row.append(new Gtk.Label({label: item.value, xalign: 1, ellipsize: Pango.EllipsizeMode.END, css_classes: ['dim-label']}));
      const visual = this._dashboardStatusVisual(item.state);
      if (visual)
        row.append(new Gtk.Image({icon_name: visual.icon, css_classes: [visual.css]}));
      list.append(row);
    }
    return list;
  }

  _supportList(items) {
    const visible = items.filter(entry => entry.enabled !== false);
    if (visible.length === 0)
      return this._emptyDashboardSection('help_support');
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10});
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['support-list']});
    for (const item of visible) {
      const button = new Gtk.Button({css_classes: ['flat', 'support-row']});
      const row = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10});
      const supportIcon = this._dashboardItemIcon(item, 'support-content-icon', 22);
      row.append(this._dashboardIconFrame(supportIcon, 32, ['support-icon-container']));
      const labels = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 1, hexpand: true});
      labels.append(new Gtk.Label({label: item.title, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']}));
      labels.append(new Gtk.Label({label: item.subtitle || '', xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption', 'dim-label']}));
      row.append(labels);
      row.append(new Gtk.Image({icon_name: 'go-next-symbolic', css_classes: ['external-indicator']}));
      button.set_child(row);
      button.connect('clicked', () => this._activateItem(item));
      this._attachTileContextMenu(button, 'help_support', item);
      list.append(button);
    }
    box.append(list);
    const openSupport = new Gtk.Button({label: 'Open support', halign: Gtk.Align.FILL, css_classes: ['suggested-action']});
    openSupport.connect('clicked', () => this._navigate('help_support'));
    box.append(openSupport);
    return box;
  }

  _statusClass(state) {
    return ({ok:'status-ok', warning:'status-warning', error:'status-error', info:'status-info', unknown:'dim-label'})[state] || 'dim-label';
  }

  _footer() {
    const footer = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 14, css_classes: ['footer-bar']});
    this._footerBox = footer;
    footer.append(new Gtk.Label({label: `Workspace Hub ${VERSION}`, xalign: 0, css_classes: ['caption']}));
    footer.append(new Gtk.Box({hexpand: true}));
    footer.append(new Gtk.Image({icon_name: 'security-high-symbolic'}));
    footer.append(new Gtk.Label({label: `Managed by ${this._profile.profile.managed_by || 'your organisation'}`, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption']}));
    const {attention, notChecked} = this._diagnostics.summary;
    const stateText = attention > 0
      ? `${attention} item${attention === 1 ? '' : 's'} need attention`
      : notChecked > 0
        ? `${notChecked} remote check${notChecked === 1 ? '' : 's'} deferred`
        : 'Workspace checks complete';
    footer.append(new Gtk.Image({
      icon_name: attention > 0 ? 'dialog-warning-symbolic' : 'dialog-information-symbolic',
      css_classes: [attention > 0 ? 'status-warning' : 'status-info'],
    }));
    footer.append(new Gtk.Label({label: stateText, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption']}));
    return footer;
  }

  _buildCollectionTabContent(pageId, tabId = null, controller = null) {
    const items = sortWorkspaceItems(this._profile.sections[pageId] ?? [])
      .filter(entry => entry.enabled !== false && (tabId === null || entry.tab_id === tabId));
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18, hexpand: true});

    const group = new Adw.PreferencesGroup({
      title: this._t('configured_items'),
      description: items.length === 0
        ? this._t('no_items_configured')
        : items.length === 1 ? this._t('configured_item_single') : this._t('configured_item_plural', {count: items.length}),
    });

    items.forEach((item, index) => {
      const application = item.type === 'application' ? this._appCatalog.resolveItem(item) : null;
      const itemSubtitle = item.subtitle || this._technicalTarget(item);
      const packageSource = application?.sourceLabel || (item.type === 'application' ? item.application_source : '');
      const subtitleParts = [itemSubtitle, packageSource, governanceLabel(item)].filter(Boolean);
      const row = this._plainActionRow(item.title, subtitleParts.join(' · '));
      row.add_prefix(this._dashboardItemIcon(item, 'collection-content-icon', 24));
      if (item.locked)
        row.add_suffix(new Gtk.Image({icon_name: 'security-high-symbolic', tooltip_text: 'Managed by organisation'}));

      const open = new Gtk.Button({label: this._t('context_open'), valign: Gtk.Align.CENTER});
      open.connect('clicked', () => this._activateItem(item));
      row.add_suffix(open);

      const showMoveToTab = this._moveItemTabDestinations(pageId, item).length > 0;
      const showWorkspaceTransfer = this._workspaceTransferDestinations(pageId).length > 0;
      row.add_suffix(createItemActionsMenuButton({
        labels: {
          menu: this._t('item_actions'),
          open: this._t('context_open'),
          edit: this._t('context_edit'),
          moveToTab: this._t('context_move_to_tab'),
          copyToWorkspace: this._t('context_copy_to_workspace'),
          moveToWorkspace: this._t('context_move_to_workspace'),
          moveEarlier: this._t('context_move_earlier'),
          moveLater: this._t('context_move_later'),
          remove: this._t('context_remove'),
        },
        callbacks: {
          open: () => this._activateItem(item),
          edit: () => this._openTileEditor(pageId, item),
          moveToTab: () => this._showMoveItemToTabDialog(pageId, item, this._currentPage, controller),
          copyToWorkspace: () => this._showTransferItemDialog('copy', pageId, item),
          moveToWorkspace: () => this._showTransferItemDialog('move', pageId, item),
          moveEarlier: () => this._moveTile(pageId, item.id, 'up'),
          moveLater: () => this._moveTile(pageId, item.id, 'down'),
          remove: () => this._confirmRemoveTile(pageId, item),
        },
        editable: !item.locked,
        showMoveToTab,
        showWorkspaceTransfer,
        canMoveEarlier: index > 0,
        canMoveLater: index < items.length - 1,
      }));
      group.add(row);
    });
    content.append(group);

    const advanced = new Adw.PreferencesGroup({
      title: 'Advanced',
      description: 'Technical information for IT and governance.',
    });
    const technicalDetails = new Adw.ExpanderRow({
      title: 'Technical details',
      subtitle: 'Show the exact targets from the active workspace profile.',
      use_markup: false,
    });
    for (const item of items)
      technicalDetails.add_row(this._plainActionRow(item.title, `${this._technicalTarget(item)} · ${governanceLabel(item)} · ${item.locked ? 'locked' : 'editable'} · icon ${item.icon_override || 'inherit'}`));
    advanced.add(technicalDetails);
    const management = new Adw.ExpanderRow({
      title: 'Management controls',
      subtitle: 'Mark organisation-defined items and protect them from accidental local changes.',
      use_markup: false,
    });
    for (const item of items) {
      const row = this._plainActionRow(item.title, governanceLabel(item));
      const button = new Gtk.Button({label: item.locked ? 'Unlock' : 'Mark Managed', valign: Gtk.Align.CENTER});
      button.connect('clicked', () => this._toggleManagedItem(pageId, item));
      row.add_suffix(button);
      row.set_activatable_widget(button);
      management.add_row(row);
    }
    advanced.add(management);
    content.append(advanced);
    return content;
  }

  _buildCollectionPage(pageId) {
    const [title, subtitle] = this._pageMeta(pageId);
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});

    const actions = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 12});
    const explanation = new Gtk.Label({
      label: this._collectionDescription(pageId),
      xalign: 0,
      wrap: true,
      hexpand: true,
      css_classes: ['dim-label'],
    });
    actions.append(explanation);
    if (pageId === 'apps') {
      const detectButton = new Gtk.Button({
        label: 'Set up from this computer',
        icon_name: 'system-search-symbolic',
        valign: Gtk.Align.CENTER,
      });
      detectButton.connect('clicked', () => this._previewSmartApplicationSetup());
      actions.append(detectButton);
    }
    const addButton = new Gtk.Button({
      label: this._addLabel(pageId),
      icon_name: 'list-add-symbolic',
      valign: Gtk.Align.CENTER,
      css_classes: ['suggested-action'],
    });
    addButton.connect('clicked', () => this._openTileEditor(pageId, null));
    actions.append(addButton);
    content.append(actions);

    if (this._isTabbedSection(pageId))
      content.append(this._sectionNotebook(pageId, (tabId, controller) => this._buildCollectionTabContent(pageId, tabId, controller), pageId));
    else
      content.append(this._buildCollectionTabContent(pageId));

    return this._pageShell(title, subtitle, content, {title, description: subtitle});
  }

  _collectionDescription(pageId) {
    return ({
      apps: 'Choose which desktop applications appear in Start your work.',
      web_apps: 'Add websites and web apps. They open in the system default browser.',
      files_places: 'Add local folders or shared locations used during the workday.',
      daily_tools: 'Choose useful installed applications for regular tasks.',
      help_support: 'Configure guides, support links and support applications.',
    })[pageId] || '';
  }

  _addLabel(pageId) {
    return ({
      apps: 'Add app',
      web_apps: 'Add website',
      files_places: 'Add place',
      daily_tools: 'Add tool',
      help_support: 'Add support link',
    })[pageId] || 'Add item';
  }

  _newTileType(pageId) {
    return ({apps:'application', web_apps:'web', files_places:'place', daily_tools:'application', help_support:'web'})[pageId];
  }

  _installedApplications(currentItem = null) {
    const applications = this._appCatalog.refresh();
    if (currentItem?.desktop_id && !applications.some(app =>
      app.desktopId === currentItem.desktop_id
      && (!currentItem.application_source || currentItem.application_source === 'unknown' || app.source === currentItem.application_source))) {
      applications.unshift({
        key: `unavailable:${currentItem.desktop_id}`,
        desktopId: currentItem.desktop_id,
        name: `${currentItem.subtitle || currentItem.title} (currently unavailable)`,
        description: 'The configured application is not currently visible on this computer.',
        iconName: currentItem.icon_name || 'application-x-executable-symbolic',
        source: currentItem.application_source || 'unknown',
        sourceLabel: 'Unavailable',
        desktopFile: '',
        hostDesktopFile: '',
        defaultRoles: [],
        unavailable: true,
      });
    }
    return applications;
  }

  _applicationPicker(applications, currentItem = null) {
    const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL, spacing:10, hexpand:true});
    const search = new Gtk.SearchEntry({
      placeholder_text: 'Search installed applications…',
      hexpand: true,
      tooltip_text: 'Search installed applications',
    });
    box.append(search);

    const list = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      css_classes: ['boxed-list', 'application-picker-list'],
    });
    const scroll = new Gtk.ScrolledWindow({
      min_content_height: 260,
      max_content_height: 360,
      propagate_natural_height: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      hexpand: true,
    });
    scroll.set_child(list);
    box.append(scroll);

    const state = {selected:null};
    let selectedRow = null;
    for (const application of applications) {
      const roleText = application.defaultRoles?.join(' · ') || '';
      const sourceText = application.sourceLabel || 'Unknown source';
      const subtitle = [roleText, sourceText, application.description].filter(Boolean).join(' — ');
      const row = this._plainActionRow(application.name, subtitle, {activatable: true});
      row._application = application;
      row._searchText = `${application.name} ${application.description || ''} ${sourceText} ${application.desktopId}`.toLocaleLowerCase();
      const icon = this._appCatalog.iconFor(application);
      row.add_prefix(icon
        ? new Gtk.Image({gicon:icon, pixel_size:32})
        : new Gtk.Image({icon_name:'application-x-executable-symbolic', pixel_size:32}));
      list.append(row);

      const sameId = application.desktopId === currentItem?.desktop_id;
      const sameSource = !currentItem?.application_source
        || currentItem.application_source === 'unknown'
        || application.source === currentItem.application_source;
      if (sameId && sameSource) {
        selectedRow = row;
        state.selected = application;
      }
    }

    list.set_filter_func(row => {
      const query = search.get_text().trim().toLocaleLowerCase();
      return !query || row._searchText.includes(query);
    });
    search.connect('search-changed', () => list.invalidate_filter());
    list.connect('row-selected', (_list, row) => {
      state.selected = row?._application ?? null;
    });
    list.connect('row-activated', (_list, row) => list.select_row(row));
    if (selectedRow)
      list.select_row(selectedRow);
    else if (applications.length > 0)
      list.select_row(list.get_row_at_index(0));

    return {
      widget: box,
      getSelected: () => state.selected,
      focusSearch: () => search.grab_focus(),
    };
  }


  _smartApplicationSuggestions() {
    const applications = this._appCatalog.refresh();
    const defaultMail = this._appCatalog.defaultForScheme('mailto');
    const find = patterns => applications.find(app => {
      const value = `${app.name} ${app.desktopId}`.toLocaleLowerCase();
      return patterns.some(pattern => value.includes(pattern));
    }) ?? null;

    const roles = [
      {id:'email', title:'Email', app:defaultMail, fallback:[]},
      {id:'documents', title:'Documents', app:null, fallback:['onlyoffice', 'libreoffice writer', 'libreoffice', 'wps writer']},
      {id:'calendar', title:'Calendar', app:defaultMail && `${defaultMail.name} ${defaultMail.desktopId}`.toLocaleLowerCase().includes('evolution') ? defaultMail : null, fallback:['gnome calendar', 'calendar', 'evolution']},
      {id:'passwords', title:'Passwords', app:null, fallback:['proton pass', 'keepassxc', 'bitwarden']},
      {id:'scanning', title:'Scanning', app:null, fallback:['document scanner', 'simple-scan', 'simple scan', 'skanlite']},
      {id:'meetings', title:'Meetings', app:null, fallback:['zoom', 'microsoft teams', 'teams for linux']},
    ];

    const suggestions = [];
    for (const role of roles) {
      const application = role.app ?? find(role.fallback);
      if (!application)
        continue;
      suggestions.push({
        id: role.id,
        type: 'application',
        title: role.title,
        subtitle: application.name,
        icon_name: application.iconName || 'application-x-executable-symbolic',
        desktop_id: application.desktopId,
        application_source: application.source,
        icon_override: 'inherit',
        origin: 'local',
        locked: false,
        enabled: true,
        position: suggestions.length + 1,
        detected_role: application.defaultRoles?.[0] || 'Installed application',
      });
    }
    return suggestions;
  }

  _previewSmartApplicationSetup() {
    const suggestions = this._smartApplicationSuggestions();
    if (suggestions.length === 0) {
      this._toast.add_toast(new Adw.Toast({title:'No suitable host applications were detected'}));
      return;
    }

    const dialog = new Adw.AlertDialog({
      heading: 'Set up from this computer',
      body: 'Workspace Hub found applications on this Zorin/Linux computer. Example app tiles will be replaced; local and organisation-managed items remain unchanged.',
    });
    const group = new Adw.PreferencesGroup({
      title: 'Suggested workspace apps',
      description: `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} detected from system defaults and installed applications.`,
    });
    for (const item of suggestions) {
      const application = this._appCatalog.resolveItem(item);
      const row = this._plainActionRow(
        item.title,
        `${item.subtitle} · ${application?.sourceLabel || item.application_source}${item.detected_role ? ` · ${item.detected_role}` : ''}`
      );
      const icon = this._appCatalog.iconFor(application);
      row.add_prefix(icon
        ? new Gtk.Image({gicon:icon, pixel_size:32})
        : new Gtk.Image({icon_name:'application-x-executable-symbolic', pixel_size:32}));
      group.add(row);
    }
    dialog.set_extra_child(group);
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('apply', 'Use Suggestions');
    dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'apply')
        return;
      try {
        let next = JSON.parse(JSON.stringify(this._profile));
        const activeTabId = activeSectionTabId(next, 'apps');
        const retained = next.sections.apps.filter(item => item.origin !== 'example');
        const retainedIds = new Set(retained.map(item => item.id));
        const added = suggestions
          .filter(item => !retainedIds.has(item.id))
          .map(({detected_role: _detectedRole, ...item}) => ({...item, tab_id: activeTabId}));
        next.sections.apps = [...retained, ...added];
        next = normaliseWorkspaceSectionPositions(next, 'apps');
        next.profile.source = 'local';
        next.settings.setup_completed = true;
        await this._store.save(next, {
          action: 'host-apps-applied',
          summary: `Applied ${added.length} detected application suggestion${added.length === 1 ? '' : 's'}`,
          details: {applications:added.map(item => ({desktop_id:item.desktop_id, source:item.application_source, role:item.id}))},
        });
        this._profile = this._store.profile;
        this._refreshDiagnostics();
        this._toast.add_toast(new Adw.Toast({title:'Workspace apps updated from this computer'}));
        this._navigate('overview');
      } catch (error) {
        this._showError('Detected applications could not be applied', error);
      }
    });
    dialog.present(this);
  }


  _webIconPicker(existingItem) {
    let selectedRole = normaliseWebIconRole(existingItem?.icon_role);
    const flow = new Gtk.FlowBox({
      selection_mode: Gtk.SelectionMode.NONE,
      min_children_per_line: 2,
      max_children_per_line: 4,
      row_spacing: 8,
      column_spacing: 8,
      homogeneous: true,
      valign: Gtk.Align.START,
    });
    let groupLeader = null;
    for (const role of WEB_ICON_ROLES) {
      const button = new Gtk.ToggleButton({
        css_classes: ['web-icon-choice'],
        tooltip_text: webIconRoleLabel(role),
      });
      if (groupLeader)
        button.set_group(groupLeader);
      else
        groupLeader = button;
      const previewItem = {id: `web-icon-${role}`, type: 'web', icon_role: role};
      const icon = this._namedDashboardIcon(
        resolveTileIcon(previewItem, this._profile.settings.icon_style),
        'web-icon-choice-image',
        28,
      );
      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
        halign: Gtk.Align.CENTER,
      });
      content.append(this._dashboardIconFrame(icon, 44, ['tile-icon-container']));
      content.append(new Gtk.Label({
        label: webIconRoleLabel(role),
        wrap: true,
        justify: Gtk.Justification.CENTER,
        halign: Gtk.Align.CENTER,
        max_width_chars: 16,
        css_classes: ['caption'],
      }));
      button.set_child(content);
      if (role === selectedRole)
        button.set_active(true);
      button.connect('toggled', () => {
        if (button.get_active())
          selectedRole = role;
      });
      flow.append(button);
    }
    const scroller = new Gtk.ScrolledWindow({
      min_content_height: 190,
      max_content_height: 230,
      propagate_natural_height: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      child: flow,
    });
    return {widget: scroller, getSelected: () => selectedRole};
  }

  _openTileEditor(sectionName, existingItem, returnPage = this._currentPage) {
    if (existingItem?.locked) {
      this._toast.add_toast(new Adw.Toast({title: 'This item is managed by your organisation'}));
      return;
    }
    const type = existingItem?.type || this._newTileType(sectionName);
    if (!type) {
      this._toast.add_toast(new Adw.Toast({title: 'This section cannot be edited yet'}));
      return;
    }

    const dialog = new Adw.AlertDialog({
      heading: existingItem ? `Edit ${existingItem.title}` : this._addLabel(sectionName),
      body: this._editorHelp(type),
    });
    const form = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, margin_top: 6, margin_bottom: 6});
    const titleRow = new Adw.EntryRow({title: 'Name', text: existingItem?.title || ''});
    const subtitleRow = new Adw.EntryRow({title: 'Description', text: existingItem?.subtitle || ''});
    form.append(titleRow);
    form.append(subtitleRow);

    let targetControl = null;
    let installedApps = null;
    let iconOverrideRow = null;
    let webIconPicker = null;
    if (type === 'application') {
      installedApps = this._installedApplications(existingItem);
      if (installedApps.length === 0) {
        this._toast.add_toast(new Adw.Toast({title: 'No host applications were found'}));
        return;
      }
      const appGroup = new Adw.PreferencesGroup({
        title: 'Application',
        description: 'Choose from APT/system, Flatpak, Snap and user-installed desktop applications.',
      });
      targetControl = this._applicationPicker(installedApps, existingItem);
      appGroup.add(targetControl.widget);
      form.append(appGroup);

      const overrideValues = ['inherit', 'application', 'dashboard'];
      const currentOverride = existingItem?.icon_override || 'inherit';
      const overrideNames = Gtk.StringList.new([
        'Use workspace setting',
        'Use application icon',
        'Use dashboard icon set',
      ]);
      iconOverrideRow = new Adw.ComboRow({
        title: 'Application icon',
        subtitle: 'Override the workspace icon policy for this application only.',
        model: overrideNames,
        selected: Math.max(0, overrideValues.indexOf(currentOverride)),
      });
      iconOverrideRow._overrideValues = overrideValues;
      const iconGroup = new Adw.PreferencesGroup({
        title: 'Icon',
        description: 'Keep the workspace default or choose a different icon source for this application.',
      });
      iconGroup.add(iconOverrideRow);
      form.append(iconGroup);
    } else if (type === 'web') {
      targetControl = new Adw.EntryRow({title: 'Website address', text: existingItem?.url || 'https://'});
      form.append(targetControl);
      const iconGroup = new Adw.PreferencesGroup({
        title: 'Icon',
        description: 'Choose what this website represents. The active dashboard icon style supplies the artwork.',
      });
      webIconPicker = this._webIconPicker(existingItem);
      iconGroup.add(webIconPicker.widget);
      form.append(iconGroup);
    } else if (type === 'place') {
      targetControl = new Adw.EntryRow({title: 'Folder or shared location', text: existingItem?.uri || ''});
      const choose = new Gtk.Button({label: 'Choose folder…', valign: Gtk.Align.CENTER});
      choose.connect('clicked', () => this._chooseFolderForEntry(targetControl));
      targetControl.add_suffix(choose);
      form.append(targetControl);
    } else if (type === 'action') {
      targetControl = {get_text: () => existingItem.action};
      form.append(this._plainActionRow('Built-in action', existingItem.action));
    }

    dialog.set_extra_child(form);
    dialog.add_response('cancel', 'Cancel');
    if (existingItem)
      dialog.add_response('remove', 'Remove');
    dialog.add_response('save', existingItem ? 'Save Changes' : 'Add');
    if (existingItem)
      dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
    const syncSaveResponse = () => syncTileEditorSaveResponse(dialog, titleRow);
    titleRow.connect('changed', syncSaveResponse);
    syncSaveResponse();
    dialog.set_default_response('save');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'remove') {
        this._confirmRemoveTile(sectionName, existingItem, returnPage);
        return;
      }
      if (response !== 'save')
        return;
      this._saveTileEditor(sectionName, existingItem, type, titleRow, subtitleRow, targetControl, installedApps, iconOverrideRow, webIconPicker, returnPage);
    });
    dialog.present(this);
    if (type === 'application') {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        targetControl.focusSearch();
        return GLib.SOURCE_REMOVE;
      });
    }
  }

  _editorHelp(type) {
    return ({
      application: 'Choose an installed application and give it a clear task-oriented name.',
      web: 'Enter a website or web app address. It will open in the default browser.',
      place: 'Choose a folder or enter a supported shared location.',
      action: 'Change the user-facing name of this built-in action.',
    })[type] || '';
  }

  _chooseFolderForEntry(entry) {
    const dialog = new Gtk.FileDialog({title: 'Choose Folder', accept_label: 'Choose'});
    dialog.select_folder(this, null, (fileDialog, result) => {
      try {
        const file = fileDialog.select_folder_finish(result);
        entry.set_text(file.get_path() || file.get_uri());
      } catch (error) {
        if (!this._isDialogDismissed(error))
          this._showError('Folder could not be selected', error);
      }
    });
  }

  async _saveTileEditor(sectionName, existingItem, type, titleRow, subtitleRow, targetControl, installedApps, iconOverrideRow = null, webIconPicker = null, returnPage = sectionName) {
    const title = titleRow.get_text().trim();
    const subtitle = subtitleRow.get_text().trim();
    if (!title) {
      this._toast.add_toast(new Adw.Toast({title: 'A name is required'}));
      return;
    }

    const targetTabId = this._isTabbedSection(sectionName)
      ? activeSectionTabId(this._profile, sectionName)
      : null;
    const item = existingItem ? JSON.parse(JSON.stringify(existingItem)) : {
      id: createUniqueTileId(title, this._profile.sections),
      type,
      ...(targetTabId ? {tab_id: targetTabId} : {}),
      position: (this._profile.sections[sectionName] ?? []).filter(entry => (entry.tab_id ?? null) === targetTabId).length + 1,
      enabled: true,
      origin: 'local',
      locked: false,
      ...(type === 'application' ? {icon_override: 'inherit'} : {}),
      ...(type === 'web' ? {icon_role: 'web'} : {}),
    };
    item.title = title;
    item.subtitle = subtitle;

    if (type === 'application') {
      const app = targetControl.getSelected();
      if (!app || app.unavailable) {
        this._toast.add_toast(new Adw.Toast({title: 'Choose an available installed application'}));
        return;
      }
      const applicationChanged = !existingItem
        || existingItem.desktop_id !== app.desktopId
        || (existingItem.application_source || 'unknown') !== app.source;
      item.desktop_id = app.desktopId;
      item.application_source = app.source;
      item.icon_override = iconOverrideRow?._overrideValues?.[iconOverrideRow.get_selected()] || item.icon_override || 'inherit';
      item.icon_name = app.iconName || item.icon_name || this._fallbackIcon(type);
      if (!item.subtitle || (applicationChanged && item.subtitle === (existingItem?.subtitle || '')))
        item.subtitle = app.name;
    } else if (type === 'web') {
      item.url = targetControl.get_text().trim();
      if (!/^(https?:|mailto:)/i.test(item.url)) {
        this._toast.add_toast(new Adw.Toast({title: 'Use an HTTP, HTTPS or email address'}));
        return;
      }
      item.icon_role = normaliseWebIconRole(webIconPicker?.getSelected() || item.icon_role);
      item.icon_name ||= 'web-browser-symbolic';
    } else if (type === 'place') {
      item.uri = targetControl.get_text().trim();
      if (!/^(~\/|\/|file:|smb:|dav:|davs:)/i.test(item.uri)) {
        this._toast.add_toast(new Adw.Toast({title: 'Choose a local folder or supported shared location'}));
        return;
      }
      item.icon_name ||= 'folder-symbolic';
    }

    try {
      const next = upsertWorkspaceItem(this._profile, sectionName, item);
      await this._store.save(next, {
        action: existingItem ? 'item-updated' : 'item-added',
        summary: `${existingItem ? 'Updated' : 'Added'} ${item.title}`,
        details: {section: sectionName, item_id: item.id},
      });
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._toast.add_toast(new Adw.Toast({title: existingItem ? 'Workspace item updated' : 'Workspace item added'}));
      this._navigate(returnPage || sectionName);
    } catch (error) {
      this._showError('Workspace item could not be saved', error);
    }
  }

  _confirmRemoveTile(sectionName, item, returnPage = this._currentPage) {
    const dialog = new Adw.AlertDialog({
      heading: `Remove ${item.title}?`,
      body: 'This removes the shortcut from Workspace Hub. It does not uninstall the application or delete any files.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('remove', 'Remove');
    dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'remove')
        return;
      try {
        const next = removeWorkspaceItem(this._profile, sectionName, item.id);
        await this._store.save(next, {action:'item-removed', summary:`Removed ${item.title}`, details:{section:sectionName, item_id:item.id}});
        this._profile = this._store.profile;
        this._refreshDiagnostics();
        this._toast.add_toast(new Adw.Toast({title: 'Workspace item removed'}));
        this._navigate(returnPage || sectionName);
      } catch (error) {
        this._showError('Workspace item could not be removed', error);
      }
    });
    dialog.present(this);
  }

  _moveItemTabDestinations(sectionName, item) {
    if (!this._isTabbedSection(sectionName) || typeof item?.tab_id !== 'string')
      return [];
    return sectionTabs(this._profile, sectionName)
      .filter(tab => tab.id !== item.tab_id)
      .map(tab => ({
        id: tab.id,
        title: sectionTabDisplayTitle(tab, key => this._t(key)),
      }));
  }

  _showMoveItemToTabDialog(sectionName, item, returnPage = this._currentPage, controller = null) {
    if (item.locked) {
      this._toast.add_toast(new Adw.Toast({title: 'This item is managed by your organisation'}));
      return;
    }
    const destinations = this._moveItemTabDestinations(sectionName, item);
    if (destinations.length === 0) {
      this._toast.add_toast(new Adw.Toast({title: this._t('no_other_tabs')}));
      return;
    }

    presentMoveItemToTabDialog({
      parent: this,
      destinations,
      heading: this._t('move_item_heading', {name: item.title}),
      body: this._t('move_item_body', {section: this._pageMeta(sectionName)[0]}),
      destinationLabel: this._t('destination_tab'),
      cancelLabel: this._t('cancel'),
      moveLabel: this._t('move'),
      onConfirm: destinationTabId => this._moveItemToTab(sectionName, item, destinationTabId, returnPage, controller),
    });
  }

  async _moveItemToTab(sectionName, item, destinationTabId, returnPage = this._currentPage, controller = null) {
    const sourceTabId = item.tab_id;
    const destination = this._moveItemTabDestinations(sectionName, item)
      .find(tab => tab.id === destinationTabId);
    if (!destination) {
      this._showError('Workspace item could not be moved', new Error('The selected destination tab is no longer available'));
      return;
    }

    try {
      const next = moveWorkspaceItemToTab(this._profile, sectionName, item.id, destinationTabId);
      await this._store.save(next, {
        action: 'item-moved-to-tab',
        summary: `Moved ${item.title} to ${destination.title}`,
        details: {
          section: sectionName,
          item_id: item.id,
          source_tab_id: sourceTabId,
          destination_tab_id: destinationTabId,
        },
      });
      this._profile = this._store.profile;
      this._refreshDiagnostics();

      let updatedInPlace = false;
      if (this._isLiveSectionNotebookController(controller)) {
        const activeTabId = activeSectionTabId(this._profile, sectionName);
        controller.suppressSignals = true;
        try {
          const sourceUpdated = this._replaceSectionTabPageContent(controller, sourceTabId);
          const destinationUpdated = this._replaceSectionTabPageContent(controller, destinationTabId);
          this._selectSectionTabInNotebook(controller, activeTabId);
          updatedInPlace = sourceUpdated && destinationUpdated;
        } finally {
          controller.suppressSignals = false;
        }
      }

      if (!updatedInPlace)
        this._navigate(returnPage || sectionName);
      this._toast.add_toast(new Adw.Toast({
        title: this._t('item_moved_to_tab', {name: item.title, tab: destination.title}),
      }));
    } catch (error) {
      this._showError('Workspace item could not be moved', error);
    }
  }

  _workspaceTransferDestinations(sectionName) {
    const sourceWorkspaceId = this._store.getWorkspaceLibrarySummary().activeWorkspaceId;
    return this._store.getWorkspaceTransferDestinations(sourceWorkspaceId, sectionName)
      .map(destination => ({
        ...destination,
        tabs: destination.tabs.map(tab => ({
          ...tab,
          displayTitle: tab.isDefault ? this._t('general_tab') : tab.title,
        })),
      }));
  }

  _showTransferItemDialog(mode, sectionName, item) {
    if (item.locked) {
      this._toast.add_toast(new Adw.Toast({title: 'This item is managed by your organisation'}));
      return;
    }
    const sourceWorkspaceId = this._store.getWorkspaceLibrarySummary().activeWorkspaceId;
    const destinations = this._workspaceTransferDestinations(sectionName);
    if (destinations.length === 0) {
      this._toast.add_toast(new Adw.Toast({title: this._t('no_other_workspaces')}));
      return;
    }
    const dialogKey = `${mode}:${sourceWorkspaceId}:${sectionName}:${item.id}`;
    if (this._workspaceTransferDialogs.has(dialogKey))
      return;
    this._workspaceTransferDialogs.add(dialogKey);

    presentTransferItemDialog({
      parent: this,
      mode,
      destinations,
      heading: this._t(mode === 'copy' ? 'copy_item_workspace_heading' : 'move_item_workspace_heading', {name: item.title}),
      body: this._t('transfer_item_workspace_body', {section: this._pageMeta(sectionName)[0]}),
      workspaceLabel: this._t('destination_workspace'),
      tabLabel: this._t('destination_tab'),
      cancelLabel: this._t('cancel'),
      confirmLabel: this._t(mode === 'copy' ? 'copy' : 'move'),
      onClosed: () => this._workspaceTransferDialogs.delete(dialogKey),
      onError: error => this._showError('Workspace transfer dialog failed', error),
      onConfirm: selection => this._transferItemToWorkspace({
        mode,
        sourceWorkspaceId,
        sectionName,
        item,
        ...selection,
      }),
    });
  }


  _reconcileWorkspaceTransferView({mode, sourceWorkspaceId, destinationWorkspaceId, sectionName, metadata}) {
    this._profile = this._store.profile;
    const activeWorkspaceId = this._store.getWorkspaceLibrarySummary().activeWorkspaceId;
    const plan = buildTransferViewRefreshPlan({
      mode,
      activeWorkspaceId,
      sourceWorkspaceId,
      destinationWorkspaceId,
      sectionName,
      sourceTabId: metadata.sourceTabId,
      destinationTabId: metadata.destinationTabId,
      currentPage: this._currentPage,
    });

    if (plan.kind === 'none')
      return {method: 'none', plan};

    this._refreshDiagnostics();
    if (this._isTabbedSection(sectionName) && plan.tabId) {
      const controller = this._findLiveSectionNotebookController({
        workspaceId: plan.workspaceId,
        pageId: plan.pageId,
        sectionName: plan.sectionName,
      });
      if (controller) {
        controller.suppressSignals = true;
        try {
          if (this._replaceSectionTabPageContent(controller, plan.tabId)) {
            this._selectSectionTabInNotebook(controller, activeSectionTabId(this._profile, sectionName));
            return {method: 'targeted', plan};
          }
        } finally {
          controller.suppressSignals = false;
        }
      }
    }

    this._navigate(this._currentPage);
    return {method: 'page-fallback', plan};
  }

  async _transferItemToWorkspace({
    mode,
    sourceWorkspaceId,
    destinationWorkspaceId,
    destinationTabId,
    sectionName,
    item,
  }) {
    const operationKey = `${mode}:${sourceWorkspaceId}:${destinationWorkspaceId}:${sectionName}:${item.id}:${destinationTabId ?? ''}`;
    if (this._workspaceTransferOperations.has(operationKey))
      return;
    this._workspaceTransferOperations.add(operationKey);
    try {
      const result = await this._store.transferWorkspaceItem({
        mode,
        sourceWorkspaceId,
        destinationWorkspaceId,
        sectionName,
        sourceItemId: item.id,
        destinationTabId,
      });
      this._profile = this._store.profile;
      this._rebuildSidebar();
      this._reconcileWorkspaceTransferView({
        mode,
        sourceWorkspaceId,
        destinationWorkspaceId,
        sectionName,
        metadata: result.metadata,
      });

      const destination = this._store.listWorkspaces().find(workspace => workspace.id === destinationWorkspaceId);
      const titleKey = mode === 'copy' ? 'item_copied_to_workspace' : 'item_moved_to_workspace';
      const toastTitle = result.historyWarning
        ? this._t('transfer_history_warning')
        : this._t(titleKey, {name: item.title, workspace: destination?.name ?? destinationWorkspaceId});
      this._toast.add_toast(new Adw.Toast({title: toastTitle, timeout: result.historyWarning ? 8 : 5}));
    } catch (error) {
      this._showError(mode === 'copy' ? 'Workspace item could not be copied' : 'Workspace item could not be moved', error);
    } finally {
      this._workspaceTransferOperations.delete(operationKey);
    }
  }

  async _moveTile(sectionName, itemId, direction, returnPage = this._currentPage) {
    try {
      const next = moveWorkspaceItem(this._profile, sectionName, itemId, direction);
      await this._store.save(next, {action:'item-moved', summary:`Moved ${itemId} ${direction}`, details:{section:sectionName, item_id:itemId, direction}});
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._navigate(returnPage || sectionName);
    } catch (error) {
      this._showError('Workspace item could not be moved', error);
    }
  }

  _toggleManagedItem(sectionName, item) {
    const makeManaged = !item.locked;
    const dialog = new Adw.AlertDialog({
      heading: makeManaged ? `Manage ${item.title}?` : `Unlock ${item.title}?`,
      body: makeManaged
        ? 'Managed items cannot be edited, moved or removed through the everyday controls. This is a local governance guard, not an operating-system security boundary.'
        : 'The item will become locally editable again.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('apply', makeManaged ? 'Mark Managed' : 'Unlock');
    dialog.set_response_appearance('apply', makeManaged ? Adw.ResponseAppearance.SUGGESTED : Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'apply')
        return;
      try {
        const next = setWorkspaceItemGovernance(this._profile, sectionName, item.id, {
          origin: makeManaged ? 'organisation' : 'local',
          locked: makeManaged,
        });
        await this._store.save(next, {
          action: makeManaged ? 'item-managed' : 'item-unlocked',
          summary: `${makeManaged ? 'Managed' : 'Unlocked'} ${item.title}`,
          details: {section:sectionName, item_id:item.id},
        });
        this._profile = this._store.profile;
        this._toast.add_toast(new Adw.Toast({title: makeManaged ? 'Item marked as managed' : 'Item unlocked'}));
        this._navigate(sectionName);
      } catch (error) {
        this._showError('Item governance could not be changed', error);
      }
    });
    dialog.present(this);
  }

  _technicalTarget(item) {
    if (item.type === 'application') return `${item.desktop_id} · ${item.application_source || 'unknown source'}`;
    if (item.type === 'web') return item.url;
    if (item.type === 'place') return item.uri;
    if (item.type === 'action') return item.action;
    return 'Unknown target';
  }

  _reviewHealthCheck(check) {
    if (check.item.locked) {
      this._navigate(check.section);
      this._toast.add_toast(new Adw.Toast({title: 'This item is managed by your organisation'}));
      return;
    }
    this._openTileEditor(check.section, check.item);
  }

  _confirmRemoteCheck(check) {
    const dialog = new Adw.AlertDialog({
      heading: `Test ${check.title}?`,
      body: 'This explicit test contacts the configured shared location. Workspace Hub will not mount it automatically or store credentials.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('test', 'Test Location');
    dialog.set_response_appearance('test', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response !== 'test')
        return;
      this._availability.checkRemotePlace(check.item, (error) => {
        if (error) {
          this._showError('Shared location could not be tested', error);
          return;
        }
        this._refreshDiagnostics();
        const updated = this._diagnosticFor(check.item);
        this._toast.add_toast(new Adw.Toast({
          title: updated?.status === 'remote-available' ? 'Shared location is reachable' : 'Shared location needs attention',
          timeout: 8,
        }));
        this._navigate('workspace_status');
      });
    });
    dialog.present(this);
  }

  _workspaceReadiness() {
    return evaluateWorkspaceReadiness(this._profile, this._diagnostics);
  }

  _readinessVisual(state) {
    if (state === 'ready' || state === 'pass')
      return {icon:'emblem-ok-symbolic', css:'status-ok'};
    if (state === 'incomplete' || state === 'fail')
      return {icon:'dialog-error-symbolic', css:'status-error'};
    if (state === 'needs-review' || state === 'warning')
      return {icon:'dialog-warning-symbolic', css:'status-warning'};
    return {icon:'dialog-information-symbolic', css:'status-info'};
  }

  _showReadinessReview() {
    const readiness = this._workspaceReadiness();
    const dialog = new Adw.AlertDialog({heading: readiness.label, body: readiness.summary});
    const details = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin_top: 6});
    for (const check of readiness.checks) {
      const visual = this._readinessVisual(check.state);
      const row = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10});
      row.append(new Gtk.Image({icon_name: visual.icon, css_classes: [visual.css], valign: Gtk.Align.START}));
      const copy = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true});
      copy.append(new Gtk.Label({label: check.title, xalign: 0, wrap: true, css_classes: ['heading']}));
      copy.append(new Gtk.Label({label: check.detail, xalign: 0, wrap: true, css_classes: ['dim-label']}));
      row.append(copy);
      details.append(row);
    }
    dialog.set_extra_child(details);
    dialog.add_response('close', 'Close');
    dialog.set_close_response('close');
    dialog.present(this);
  }

  _buildReadinessGroup() {
    const readiness = this._workspaceReadiness();
    const visual = this._readinessVisual(readiness.status);
    const group = new Adw.PreferencesGroup({
      title: 'Workspace readiness',
      description: 'A beta deployment check based on setup, profile content and current health results.',
    });
    const row = this._plainActionRow(readiness.label, readiness.summary);
    row.add_prefix(new Gtk.Image({icon_name: visual.icon, css_classes: [visual.css]}));
    const button = new Gtk.Button({label: 'Review', valign: Gtk.Align.CENTER});
    button.connect('clicked', () => this._showReadinessReview());
    row.add_suffix(button);
    row.set_activatable_widget(button);
    group.add(row);
    return group;
  }

  _buildWorkspaceStatus() {
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});
    content.append(this._buildReadinessGroup());
    const group = new Adw.PreferencesGroup({
      title: 'Workspace status',
      description: `Last checked ${this._diagnostics.checkedAt}. Remote locations are not contacted automatically.`,
    });
    for (const item of this._workspaceStatusItems()) {
      const row = this._plainActionRow(item.title, item.value);
      row.add_prefix(new Gtk.Image({icon_name: item.icon_name || 'dialog-information-symbolic'}));
      row.add_suffix(new Gtk.Image({icon_name: item.state === 'ok' ? 'emblem-ok-symbolic' : item.state === 'warning' ? 'dialog-warning-symbolic' : 'dialog-information-symbolic', css_classes: [this._statusClass(item.state)]}));
      group.add(row);
    }
    content.append(group);

    const attentionChecks = this._diagnostics.checks.filter(check => !['available', 'valid', 'supported', 'remote-available', 'not-checked'].includes(check.status));
    if (attentionChecks.length > 0) {
      const attentionGroup = new Adw.PreferencesGroup({
        title: 'Needs attention',
        description: 'Review items that cannot currently be used as configured.',
      });
      for (const check of attentionChecks) {
        const row = this._plainActionRow(check.title, check.detail);
        row.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic', css_classes: ['status-warning']}));
        const button = new Gtk.Button({label: check.item.locked ? 'Details' : 'Review', valign: Gtk.Align.CENTER});
        button.connect('clicked', () => this._reviewHealthCheck(check));
        row.add_suffix(button);
        row.set_activatable_widget(button);
        attentionGroup.add(row);
      }
      content.append(attentionGroup);
    }

    const remoteChecks = this._diagnostics.checks.filter(check => check.type === 'place' && /^(smb:|dav:|davs:)/i.test(check.item.uri));
    if (remoteChecks.length > 0) {
      const remoteGroup = new Adw.PreferencesGroup({
        title: 'Shared locations',
        description: 'Remote locations are contacted only when you explicitly test them.',
      });
      for (const check of remoteChecks) {
        const row = this._plainActionRow(check.title, check.detail);
        const visual = this._diagnosticVisual(check);
        row.add_prefix(new Gtk.Image({icon_name: visual.icon, css_classes: [visual.css]}));
        const button = new Gtk.Button({label: 'Test', valign: Gtk.Align.CENTER});
        button.connect('clicked', () => this._confirmRemoteCheck(check));
        row.add_suffix(button);
        row.set_activatable_widget(button);
        remoteGroup.add(row);
      }
      content.append(remoteGroup);
    }

    const actions = new Adw.PreferencesGroup({
      title: 'Checks and support',
      description: 'Run local checks again or create a privacy-aware report for IT support.',
    });
    const runRow = new Adw.ActionRow({title: 'Run workspace checks', subtitle: 'Check installed applications and local folders now.', use_markup: false});
    const runButton = new Gtk.Button({label: 'Run Checks', valign: Gtk.Align.CENTER});
    runButton.connect('clicked', () => this._runDiagnostics());
    runRow.add_suffix(runButton);
    runRow.set_activatable_widget(runButton);
    actions.add(runRow);
    const exportRow = new Adw.ActionRow({title: 'Export Diagnostic Report…', subtitle: 'Preview and export technical results without passwords, tokens or document contents.', use_markup: false});
    const exportButton = new Gtk.Button({label: 'Export', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    exportButton.connect('clicked', () => this._previewDiagnosticExport());
    exportRow.add_suffix(exportButton);
    exportRow.set_activatable_widget(exportButton);
    actions.add(exportRow);
    content.append(actions);

    const diagnosticsGroup = new Adw.PreferencesGroup({
      title: 'Advanced',
      description: 'Exact results for IT and governance.',
    });
    const diagnostics = new Adw.ExpanderRow({
      title: 'Diagnostic summary',
      subtitle: `${this._diagnostics.summary.available} verified · ${this._diagnostics.summary.configured} configured · ${this._diagnostics.summary.attention} attention · ${this._diagnostics.summary.notChecked} not checked`,
      use_markup: false,
    });
    const summary = profileSummary(this._profile);
    for (const [title, value] of [
      ['Profile', this._profile.profile.name],
      ['Profile revision', this._profile.profile.revision || 'Not set'],
      ['Profile source', this._profile.profile.source],
      ['Schema version', String(this._profile.schema_version)],
      ['Default browser', this._diagnostics.browser.name],
      ['Default browser ID', this._diagnostics.browser.id || 'Not detected'],
      ['Configured applications', String(summary.apps + summary.dailyTools)],
      ['Configured websites', String(summary.webApps)],
      ['Configured places', String(summary.places)],
    ]) diagnostics.add_row(this._plainActionRow(title, value));
    diagnosticsGroup.add(diagnostics);

    const itemChecks = new Adw.ExpanderRow({
      title: 'Item checks',
      subtitle: 'Inspect each configured target and its exact result.',
      use_markup: false,
    });
    for (const check of this._diagnostics.checks)
      itemChecks.add_row(this._plainActionRow(check.title, `${check.status} — ${check.detail}`));
    diagnosticsGroup.add(itemChecks);
    content.append(diagnosticsGroup);

    const [statusTitle, statusSubtitle] = this._pageMeta('workspace_status');
    return this._pageShell(statusTitle, statusSubtitle, content, {
      title: statusTitle,
      description: 'See whether the everyday workspace is ready, without exposing unnecessary technical complexity.',
    });
  }

  _maybeShowOnboarding() {
    if (this._onboardingShown || this._profile.settings.setup_completed)
      return;
    this._onboardingShown = true;
    const dialog = new Adw.AlertDialog({
      heading: this._t('welcome'),
      body: this._t('welcome_body'),
    });
    dialog.add_response('import', this._t('import_workspace'));
    dialog.add_response('example', this._t('explore_example'));
    dialog.add_response('setup', this._t('setup_workspace'));
    dialog.set_response_appearance('setup', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('setup');
    dialog.set_close_response('example');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'setup')
        this._previewSmartApplicationSetup();
      else if (response === 'import')
        this._chooseImport();
      else
        this._completeExampleOnboarding();
    });
    dialog.present(this);
  }

  async _completeExampleOnboarding() {
    try {
      const next = JSON.parse(JSON.stringify(this._profile));
      next.settings.setup_completed = true;
      await this._store.save(next, {action:'onboarding-completed', summary:'Example workspace selected'});
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._toast.add_toast(new Adw.Toast({title: 'Example workspace ready'}));
      this._navigate('overview');
    } catch (error) {
      this._showError('Example workspace could not be prepared', error);
    }
  }

  async _resetCurrentWorkspace() {
    const workspaceName = this._profile.profile.name;
    try {
      const resetProfile = resetWorkspaceContent(this._profile);
      await this._store.save(resetProfile, {
        action: 'workspace-reset',
        summary: `Reset ${workspaceName}`,
      });
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._toast.add_toast(new Adw.Toast({title: `${workspaceName} reset`}));
      this._navigate('settings');
    } catch (error) {
      this._showError('Workspace could not be reset', error);
    }
  }

  _confirmResetCurrentWorkspace() {
    const workspaceName = this._profile.profile.name;
    const dialog = new Adw.AlertDialog({
      heading: `Reset “${workspaceName}”?`,
      body: 'A restore point of the current configuration will be created first. Then all configured items and custom tabs are removed from this workspace. The workspace itself and other workspaces remain available.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('reset', 'Reset Workspace');
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'reset')
        this._resetCurrentWorkspace();
    });
    dialog.present(this);
  }

  async _createExampleWorkspace() {
    try {
      await this._store.createExampleWorkspace({activate: true});
      const workspaceName = this._store.profile.profile.name;
      this._refreshWorkspaceView('overview');
      this._toast.add_toast(new Adw.Toast({title: `${workspaceName} created`}));
    } catch (error) {
      this._showError('Example workspace could not be created', error);
    }
  }

  _confirmCreateExampleWorkspace() {
    const dialog = new Adw.AlertDialog({
      heading: 'Create an example workspace?',
      body: 'A new independent workspace with the original sample apps, links and places will be added and opened. Existing workspaces are not changed.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('create', 'Create Example');
    dialog.set_response_appearance('create', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('create');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'create')
        this._createExampleWorkspace();
    });
    dialog.present(this);
  }

  async _saveAppearance(iconStyle, applicationIconPolicy, visibility, language) {
    try {
      const next = JSON.parse(JSON.stringify(this._profile));
      next.settings.icon_style = iconStyle;
      next.settings.application_icon_policy = applicationIconPolicy;
      next.settings.section_visibility = {...visibility};
      const languageChanged = this._store.applicationSettings.language !== language;
      next.profile.source = 'local';
      await this._store.save(next, {action:'appearance-updated', summary:'Updated dashboard appearance'}, {language});
      this._profile = this._store.profile;
      if (languageChanged)
        this._rebuildSidebar();
      this._toast.add_toast(new Adw.Toast({title: 'Appearance saved — dashboard updated'}));
      this._navigate('overview');
    } catch (error) {
      this._showError('Appearance could not be saved', error);
    }
  }

  _buildHistoryGroup() {
    const history = this._store.getHistory();
    const restorePoints = new Map(this._store.getRestorePoints().map(record => [record.id, record]));
    const group = new Adw.PreferencesGroup({
      title: 'Workspace History',
      description: history.length === 0
        ? 'Changes will appear here after the workspace is updated.'
        : 'Recent local changes and imports. Restore points are stored only on this workstation.',
    });

    if (history.length === 0) {
      group.add(this._plainActionRow('No recorded changes yet', 'The current workspace is the starting point.'));
      return group;
    }

    for (const record of history.slice(0, 12)) {
      const row = this._plainActionRow(record.summary, `${record.timestamp} · ${record.action}`);
      const restore = restorePoints.get(record.id);
      if (restore) {
        const button = new Gtk.Button({label: 'Restore', valign: Gtk.Align.CENTER});
        button.connect('clicked', () => this._confirmRestorePoint(restore));
        row.add_suffix(button);
      }
      group.add(row);
    }
    return group;
  }

  _confirmRestorePoint(record) {
    const dialog = new Adw.AlertDialog({
      heading: 'Restore this workspace version?',
      body: `${record.summary}\n${record.timestamp}\n\nThe current configuration will first be kept as a new restore point.`,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('restore', 'Restore Version');
    dialog.set_response_appearance('restore', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'restore')
        return;
      try {
        this._profile = await this._store.restoreRevision(record.restore_file);
        this._refreshDiagnostics();
        this._rebuildSidebar();
        this._toast.add_toast(new Adw.Toast({title: 'Workspace version restored'}));
        this._navigate('overview');
      } catch (error) {
        this._showError('Workspace version could not be restored', error);
      }
    });
    dialog.present(this);
  }

  _buildSettings() {
    const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});
    const summary = profileSummary(this._profile);

    content.append(this._buildReadinessGroup());

    const identityGroup = new Adw.PreferencesGroup({
      title: 'Workspace identity',
      description: 'Set the names shown to users without editing JSON files.',
    });
    const identityFields = [
      ['name', 'Workspace name', this._profile.profile.name],
      ['organisation', 'Organisation', this._profile.profile.organisation || ''],
      ['managed_by', 'Managed by', this._profile.profile.managed_by || ''],
      ['greeting_name', 'Greeting name', this._profile.settings.greeting_name || ''],
      ['revision', 'Profile revision', this._profile.profile.revision || ''],
    ];
    this._identityEntries = new Map();
    for (const [key, title, value] of identityFields) {
      const row = new Adw.EntryRow({title, text: value});
      this._identityEntries.set(key, row);
      identityGroup.add(row);
    }
    const saveIdentityRow = new Adw.ActionRow({title: 'Save workspace identity', subtitle: 'Update the dashboard and exported profile.', use_markup: false});
    const saveIdentityButton = new Gtk.Button({label: 'Save', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    saveIdentityButton.connect('clicked', () => this._saveWorkspaceIdentity());
    saveIdentityRow.add_suffix(saveIdentityButton);
    saveIdentityRow.set_activatable_widget(saveIdentityButton);
    identityGroup.add(saveIdentityRow);
    content.append(identityGroup);

    const appearanceGroup = new Adw.PreferencesGroup({
      title: this._t('appearance'),
      description: 'Keep the GNOME interface native while choosing how dashboard content icons are presented.',
    });
    const iconStyleValues = ['fluent-linux-color', 'fluent-linux-grey', 'fluent-ui-color', 'system'];
    const currentIconStyle = normaliseIconStyle(this._profile.settings.icon_style);
    const iconNames = Gtk.StringList.new([
      this._t('fluent_linux_color'),
      this._t('fluent_linux_grey'),
      this._t('fluent_ui_color'),
      this._t('inherit_theme'),
    ]);
    const iconStyle = new Adw.ComboRow({
      title: 'Icon style',
      subtitle: iconStyleDescription(currentIconStyle),
      model: iconNames,
      selected: Math.max(0, iconStyleValues.indexOf(currentIconStyle)),
    });
    iconStyle.connect('notify::selected', () => {
      const selected = iconStyleValues[iconStyle.get_selected()] || 'fluent-linux-color';
      iconStyle.set_subtitle(iconStyleDescription(selected));
    });
    appearanceGroup.add(iconStyle);

    const applicationPolicyValues = ['application', 'dashboard'];
    const applicationPolicyNames = Gtk.StringList.new([
      'Use application icons',
      'Use dashboard icon set',
    ]);
    const applicationPolicy = new Adw.ComboRow({
      title: 'Application icons',
      subtitle: 'Use each linked application’s own icon by default, or apply the selected dashboard icon set.',
      model: applicationPolicyNames,
      selected: Math.max(0, applicationPolicyValues.indexOf(this._profile.settings.application_icon_policy || 'application')),
    });
    appearanceGroup.add(applicationPolicy);

    const languageValues = ['system', 'en', 'nl', 'de'];
    const languageNames = Gtk.StringList.new(languageValues.map(value => languageLabel(value)));
    const languageRow = new Adw.ComboRow({
      title: this._t('language'),
      subtitle: 'System follows the current Linux language when English, Dutch or German is available.',
      model: languageNames,
      selected: Math.max(0, languageValues.indexOf(this._store.applicationSettings.language)),
    });
    appearanceGroup.add(languageRow);

    const visibilityRows = new Map();
    const visibilityLabels = [
      ['apps', 'Start your work'],
      ['web_apps', 'Web apps & websites'],
      ['files_places', 'Files & places'],
      ['workspace_status', 'Workspace status'],
      ['help_support', 'Help & support'],
    ];
    for (const [key, title] of visibilityLabels) {
      const row = new Adw.SwitchRow({
        title,
        subtitle: this._t('section_visibility_help'),
        use_markup: false,
        active: this._profile.settings.section_visibility[key],
      });
      visibilityRows.set(key, row);
      appearanceGroup.add(row);
    }
    const saveAppearanceRow = this._plainActionRow('Save appearance', `Current icon style: ${iconStyleLabel(this._profile.settings.icon_style)}`);
    const saveAppearanceButton = new Gtk.Button({label: this._t('save'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    saveAppearanceButton.connect('clicked', () => {
      const visibility = Object.fromEntries([...visibilityRows].map(([key, row]) => [key, row.get_active()]));
      this._saveAppearance(
        iconStyleValues[iconStyle.get_selected()] || 'fluent-linux-color',
        applicationPolicyValues[applicationPolicy.get_selected()] || 'application',
        visibility,
        languageValues[languageRow.get_selected()]
      );
    });
    saveAppearanceRow.add_suffix(saveAppearanceButton);
    saveAppearanceRow.set_activatable_widget(saveAppearanceButton);
    appearanceGroup.add(saveAppearanceRow);
    content.append(appearanceGroup);

    const setupGroup = new Adw.PreferencesGroup({
      title: 'Workspace setup',
      description: 'Reset the active workspace, add a fresh example workspace or detect apps from this computer.',
    });
    const workspaceName = this._profile.profile.name;
    const resetRow = new Adw.ActionRow({
      title: 'Reset current workspace',
      subtitle: `Remove all configured items and custom tabs from “${workspaceName}”. Other workspaces are not changed.`,
      use_markup: false,
    });
    const resetButton = new Gtk.Button({label: 'Reset Workspace', valign: Gtk.Align.CENTER});
    resetButton.connect('clicked', () => this._confirmResetCurrentWorkspace());
    resetRow.add_suffix(resetButton);
    resetRow.set_activatable_widget(resetButton);
    setupGroup.add(resetRow);
    const exampleRow = new Adw.ActionRow({
      title: 'Create example workspace',
      subtitle: 'Add a new independent example workspace with sample apps, links and places. Existing workspaces are not changed.',
      use_markup: false,
    });
    const exampleButton = new Gtk.Button({label: 'Create Example', valign: Gtk.Align.CENTER});
    exampleButton.connect('clicked', () => this._confirmCreateExampleWorkspace());
    exampleRow.add_suffix(exampleButton);
    exampleRow.set_activatable_widget(exampleButton);
    setupGroup.add(exampleRow);
    const detectRow = new Adw.ActionRow({
      title: 'Set up from this computer',
      subtitle: 'Detect APT/system, Flatpak, Snap and user-installed applications and preview suggested workspace apps.',
      use_markup: false,
    });
    const detectButton = new Gtk.Button({label:'Detect Apps', valign:Gtk.Align.CENTER, css_classes:['suggested-action']});
    detectButton.connect('clicked', () => this._previewSmartApplicationSetup());
    detectRow.add_suffix(detectButton);
    detectRow.set_activatable_widget(detectButton);
    setupGroup.add(detectRow);
    content.append(setupGroup);

    const profileGroup = new Adw.PreferencesGroup({
      title: 'Workspace Profile',
      description: 'Import or export a complete workspace without accounts, servers or team management.',
    });
    for (const [title, value] of [
      ['Profile', summary.name],
      ['Organisation', summary.organisation || 'Not set'],
      ['Revision', summary.revision || 'Not set'],
      ['Managed by', this._profile.profile.managed_by || 'Not set'],
      ['Profile source', this._profile.profile.source],
      ['Workspace schema version', String(this._profile.schema_version)],
      ['Workspace library schema', String(this._store.library.schema_version)],
      ['Workspaces stored', String(this._store.library.workspaces.length)],
    ]) profileGroup.add(this._plainActionRow(title, value));

    const importRow = new Adw.ActionRow({title: 'Import Workspace…', subtitle: 'Choose a Workspace Hub JSON profile and preview its contents before applying it.', use_markup: false});
    const importButton = new Gtk.Button({label: 'Import', valign: Gtk.Align.CENTER});
    importButton.connect('clicked', () => this._chooseImport());
    importRow.add_suffix(importButton);
    importRow.set_activatable_widget(importButton);
    profileGroup.add(importRow);

    const exportRow = new Adw.ActionRow({title: 'Export Workspace…', subtitle: 'Create a portable JSON profile for another workstation.', use_markup: false});
    const exportButton = new Gtk.Button({label: 'Export', valign: Gtk.Align.CENTER});
    exportButton.connect('clicked', () => this._chooseExport());
    exportRow.add_suffix(exportButton);
    exportRow.set_activatable_widget(exportButton);
    profileGroup.add(exportRow);

    content.append(profileGroup);
    content.append(this._buildHistoryGroup());

    const advanced = new Adw.PreferencesGroup({
      title: 'Advanced',
      description: 'Technical transparency for IT and governance. These details are not required for everyday use.',
    });
    const profileDetails = new Adw.ExpanderRow({
      title: 'Technical profile details',
      subtitle: 'Show format identifiers and local storage paths.',
      use_markup: false,
    });
    for (const [title, value] of [
      ['Profile format', this._profile.format],
      ['Profile ID', this._profile.profile.id],
      ['Profile source', this._profile.profile.source],
      ['Workspace library format', this._store.library.format],
      ['Workspace library schema', String(this._store.library.schema_version)],
      ['Active workspace ID', this._store.library.active_workspace_id],
      ['Application language', this._store.applicationSettings.language],
      ['Detected browser', this._detectDefaultBrowser()],
      ['Detected email application', this._appCatalog.defaultForScheme('mailto')?.name || 'Not detected'],
      ['Application catalog', `${this._appCatalog.list().length} host applications · system packages, Flatpak, Snap and user launchers`],
      ['Flatpak inventory', `${this._appCatalog.list().filter(app => app.source.startsWith('flatpak-')).length} installed Flatpak applications · host list plus desktop exports`],
      ['Host launch bridge', GLib.getenv('FLATPAK_ID') ? 'Flatpak apps: host flatpak run · other confirmed apps: host gio launch' : 'Flatpak apps: flatpak run · other apps: native GIO launch'],
      ['Workspace library path', this._store.libraryPath],
      ['Legacy profile path', this._store.legacyProfilePath],
      ['Workspace history path', this._store.historyPath],
      ['Restore points path', this._store.restoreDirectoryPath],
      ['Deleted workspace backups', this._store.deletedWorkspaceDirectoryPath],
    ]) profileDetails.add_row(this._plainActionRow(title, value));
    advanced.add(profileDetails);
    content.append(advanced);

    const [settingsTitle, settingsSubtitle] = this._pageMeta('settings');
    return this._pageShell(settingsTitle, settingsSubtitle, content, {
      title: settingsTitle,
      description: 'Keep everyday controls simple while preserving complete technical visibility for IT.',
    });
  }


  async _saveWorkspaceIdentity() {
    const next = JSON.parse(JSON.stringify(this._profile));
    next.profile.name = this._identityEntries.get('name').get_text().trim();
    next.profile.organisation = this._identityEntries.get('organisation').get_text().trim();
    next.profile.managed_by = this._identityEntries.get('managed_by').get_text().trim();
    next.profile.revision = this._identityEntries.get('revision').get_text().trim();
    next.profile.source = 'local';
    next.settings.greeting_name = this._identityEntries.get('greeting_name').get_text().trim();
    if (!next.profile.name) {
      this._toast.add_toast(new Adw.Toast({title: 'Workspace name is required'}));
      return;
    }
    try {
      await this._store.save(next, {action:'identity-updated', summary:'Updated workspace identity'});
      this._profile = this._store.profile;
      this._refreshDiagnostics();
      this._rebuildSidebar();
      this._toast.add_toast(new Adw.Toast({title: 'Workspace identity saved'}));
      this._navigate('settings');
    } catch (error) {
      this._showError('Workspace identity could not be saved', error);
    }
  }

  _computeDiagnostics(profile) {
    return this._availability.checkProfile(profile);
  }

  _refreshDiagnostics() {
    this._diagnostics = this._computeDiagnostics(this._profile);
  }

  _detectDefaultBrowser() {
    return this._diagnostics?.browser?.name || this._availability.detectDefaultBrowser().name;
  }

  _workspaceStatusItems() {
    const diagnostics = this._diagnostics;
    const apps = diagnostics.summary.applications;
    const places = diagnostics.summary.places;
    return [
      {
        id: 'applications',
        title: 'Applications',
        value: `${apps.available} of ${apps.total} available`,
        state: apps.missing > 0 ? 'warning' : 'ok',
        source: 'detected',
        icon_name: 'view-app-grid-symbolic',
      },
      {
        id: 'websites',
        title: 'Web apps and websites',
        value: `${diagnostics.summary.websites.valid} of ${diagnostics.summary.websites.total} valid`,
        state: diagnostics.summary.websites.invalid > 0 ? 'warning' : 'info',
        source: 'configured',
        icon_name: 'web-browser-symbolic',
      },
      {
        id: 'places',
        title: 'Files and places',
        value: `${places.available} local · ${places.remoteAvailable} remote available · ${places.remoteUnavailable} remote attention · ${places.remoteConfigured} not checked`,
        state: places.missing > 0 ? 'warning' : 'info',
        source: 'detected',
        icon_name: 'folder-remote-symbolic',
      },
      {
        id: 'browser',
        title: 'Default browser',
        value: diagnostics.browser.name,
        state: diagnostics.browser.detected ? 'info' : 'warning',
        source: 'detected',
        icon_name: 'web-browser-symbolic',
      },
    ];
  }

  _runDiagnostics() {
    this._refreshDiagnostics();
    this._toast.add_toast(new Adw.Toast({title: 'Workspace checks completed'}));
    this._navigate('workspace_status');
  }

  _previewDiagnosticExport() {
    this._refreshDiagnostics();
    const summary = this._diagnostics.summary;
    const dialog = new Adw.AlertDialog({
      heading: 'Export diagnostic report?',
      body: `${summary.total} workspace items checked\n${summary.attention} need attention\n${summary.notChecked} remote checks deferred\n\nThe report contains app IDs, redacted targets, profile metadata and check results. It does not contain passwords, tokens, browser data or document contents.`,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('export', 'Export Report');
    dialog.set_response_appearance('export', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('export');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, response) => {
      if (response === 'export')
        this._chooseDiagnosticExport();
    });
    dialog.present(this);
  }

  _chooseDiagnosticExport() {
    const safeName = (this._profile.profile.name || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    const dialog = new Gtk.FileDialog({
      title: 'Export Diagnostic Report',
      accept_label: 'Export',
      initial_name: `${safeName}.workspace-hub-diagnostics.json`,
    });
    dialog.save(this, null, (fileDialog, result) => {
      try {
        const file = fileDialog.save_finish(result);
        const report = buildDiagnosticReport({
          profile: this._profile,
          checks: this._diagnostics.checks,
          appVersion: VERSION,
          generatedAt: this._diagnostics.checkedAt,
          platform: {
            name: GLib.get_os_info('PRETTY_NAME') || GLib.get_os_info('NAME') || 'Linux',
            version: GLib.get_os_info('VERSION_ID') || '',
          },
          homeDirectory: GLib.get_home_dir(),
        });
        const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        this._toast.add_toast(new Adw.Toast({title: 'Diagnostic report exported'}));
      } catch (error) {
        if (!this._isDialogDismissed(error))
          this._showError('Diagnostic report could not be exported', error);
      }
    });
  }

  _chooseImport() {
    const dialog = new Gtk.FileDialog({title: 'Import Workspace'});
    dialog.open(this, null, (fileDialog, result) => {
      let file;
      try {
        file = fileDialog.open_finish(result);
      } catch (error) {
        if (!this._isDialogDismissed(error))
          this._showError('Workspace could not be selected', error);
        return;
      }

      let candidate;
      try {
        candidate = this._store.loadExternal(file);
      } catch (error) {
        this._showError('This workspace profile is not valid', error);
        return;
      }
      this._previewImport(candidate);
    });
  }

  _previewImport(candidate) {
    const summary = profileSummary(candidate);
    const changes = diffProfiles(this._profile, candidate);
    const changeText = changes.total === 0
      ? 'No configuration differences were found.'
      : `${changes.added.length} added · ${changes.changed.length} changed · ${changes.removed.length} removed${changes.identityChanged ? ' · workspace settings changed' : ''}`;
    const dialog = new Adw.AlertDialog({
      heading: 'Import this workspace?',
      body: `${summary.name}

${summary.apps} applications
${summary.webApps} web apps and websites
${summary.places} files and places
${summary.dailyTools} daily tools
${summary.supportActions} support options

Changes compared with the active workspace:
${changeText}

A restore point will be created before import.`,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('import', 'Import Workspace');
    dialog.set_response_appearance('import', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('import');
    dialog.set_close_response('cancel');
    dialog.connect('response', async (_dialog, response) => {
      if (response !== 'import')
        return;
      try {
        const imported = JSON.parse(JSON.stringify(candidate));
        imported.settings.setup_completed = true;
        await this._store.importProfile(imported);
        this._profile = this._store.profile;
        this._refreshDiagnostics();
        this._rebuildSidebar();
        this._toast.add_toast(new Adw.Toast({title: 'Workspace imported'}));
        this._navigate('overview');
      } catch (error) {
        this._showError('Workspace could not be imported', error);
      }
    });
    dialog.present(this);
  }

  _chooseExport() {
    const safeName = (this._profile.profile.name || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    const dialog = new Gtk.FileDialog({
      title: 'Export Workspace',
      accept_label: 'Export',
      initial_name: `${safeName}.workspace-hub.json`,
    });
    dialog.save(this, null, (fileDialog, result) => {
      try {
        const file = fileDialog.save_finish(result);
        this._store.exportProfile(file);
        this._toast.add_toast(new Adw.Toast({title: 'Workspace exported'}));
      } catch (error) {
        if (!this._isDialogDismissed(error))
          this._showError('Workspace could not be exported', error);
      }
    });
  }

  _activateItem(item) {
    try {
      if (item.type === 'application') {
        this._appCatalog.launchWorkspaceItem(item, error => {
          if (error)
            this._showError(`${item.title} could not be opened`, error);
        });
        return;
      }
      if (item.type === 'web') {
        this._openUri(item.url, `${item.title} could not be opened`);
        return;
      }
      if (item.type === 'place') {
        this._openUri(this._normalisePlace(item.uri), `${item.title} is not currently available`);
        return;
      }
      if (item.type === 'action' && item.action === 'support-report') {
        this._previewDiagnosticExport();
        return;
      }
      throw new Error('This workspace item has no supported action.');
    } catch (error) {
      this._showError(`${item.title} could not be opened`, error);
    }
  }

  _normalisePlace(value) {
    if (value.startsWith('~/'))
      return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), value.slice(2)])).get_uri();
    if (value.startsWith('/'))
      return Gio.File.new_for_path(value).get_uri();
    return value;
  }

  _openUri(uri, failureTitle) {
    Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_source, result) => {
      try {
        Gio.AppInfo.launch_default_for_uri_finish(result);
      } catch (error) {
        this._showError(failureTitle, error);
      }
    });
  }

  _showError(title, error) {
    logError(error, title);
    const detail = error?.message ? ` ${error.message}` : '';
    this._toast.add_toast(new Adw.Toast({title: `${title}.${detail}`, timeout: 8}));
  }

  _isDialogDismissed(error) {
    return typeof error?.matches === 'function' && error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED);
  }

  _updateLayout() {
    const contentWidth = this._contentPage?.get_width?.() ?? 0;
    const width = contentWidth > 0 ? contentWidth : this.get_width();
    if (width <= 0)
      return;

    this.remove_css_class('layout-compact');
    this.remove_css_class('layout-medium');
    this.remove_css_class('layout-wide');
    this.add_css_class(width < 760 ? 'layout-compact' : width < 1180 ? 'layout-medium' : 'layout-wide');

    if (this._footerBox) {
      this._footerBox.set_orientation(width < 760 ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL);
      this._footerBox.set_halign(width < 760 ? Gtk.Align.START : Gtk.Align.FILL);
    }

    for (const entry of this._adaptiveGrids) {
      if (!entry.grid.get_parent())
        continue;
      if (entry.type === 'metrics')
        this._layoutMetrics(entry, width);
      else if (entry.type === 'sections')
        this._layoutSections(entry, width);
    }
  }

  _detach(grid, widget) {
    if (widget.get_parent() === grid)
      grid.remove(widget);
  }

  _layoutMetrics(entry, width) {
    for (const child of entry.children)
      this._detach(entry.grid, child);
    const columns = width < 700 ? 1 : width < 1180 ? 2 : 4;
    entry.children.forEach((child, index) => entry.grid.attach(child, index % columns, Math.floor(index / columns), 1, 1));
  }

  _layoutSections(entry, width) {
    for (const item of entry.children)
      this._detach(entry.grid, item.widget);
    const byKey = Object.fromEntries(entry.children.map(item => [item.key, item.widget]));
    const complete = ['apps', 'web', 'places', 'status', 'support'].every(key => byKey[key]);

    if (complete && width >= 1180) {
      entry.grid.attach(byKey.apps, 0, 0, 2, 1);
      entry.grid.attach(byKey.web, 2, 0, 2, 1);
      entry.grid.attach(byKey.places, 0, 1, 2, 1);
      entry.grid.attach(byKey.status, 2, 1, 1, 1);
      entry.grid.attach(byKey.support, 3, 1, 1, 1);
      return;
    }
    if (complete && width >= 760) {
      entry.grid.attach(byKey.apps, 0, 0, 1, 1);
      entry.grid.attach(byKey.web, 1, 0, 1, 1);
      entry.grid.attach(byKey.places, 0, 1, 2, 1);
      entry.grid.attach(byKey.status, 0, 2, 1, 1);
      entry.grid.attach(byKey.support, 1, 2, 1, 1);
      return;
    }

    const columns = width < 760 ? 1 : 2;
    entry.children.forEach((item, index) => entry.grid.attach(item.widget, index % columns, Math.floor(index / columns), 1, 1));
  }
});
