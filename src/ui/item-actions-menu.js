import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

function addAction(group, name, callback, enabled = true) {
  const action = new Gio.SimpleAction({name});
  action.set_enabled(Boolean(enabled));
  action.connect('activate', callback);
  group.add_action(action);
}

/**
 * Build the compact canonical action menu used by configured-item rows.
 *
 * The caller owns all application behaviour. This module only translates the
 * supplied action contract into a native Gtk.MenuButton backed by GMenu/GAction.
 */
export function createItemActionsMenuButton({
  labels,
  callbacks,
  editable,
  showMoveToTab,
  showWorkspaceTransfer,
  canMoveEarlier,
  canMoveLater,
}) {
  const namespace = 'itemrow';
  const group = new Gio.SimpleActionGroup();
  addAction(group, 'open', callbacks.open);
  addAction(group, 'edit', callbacks.edit, editable);
  if (showMoveToTab)
    addAction(group, 'move-to-tab', callbacks.moveToTab, editable);
  if (showWorkspaceTransfer) {
    addAction(group, 'copy-to-workspace', callbacks.copyToWorkspace, editable);
    addAction(group, 'move-to-workspace', callbacks.moveToWorkspace, editable);
  }
  addAction(group, 'move-earlier', callbacks.moveEarlier, editable && canMoveEarlier);
  addAction(group, 'move-later', callbacks.moveLater, editable && canMoveLater);
  addAction(group, 'remove', callbacks.remove, editable);

  const menu = new Gio.Menu();
  const primary = new Gio.Menu();
  primary.append(labels.open, `${namespace}.open`);
  primary.append(labels.edit, `${namespace}.edit`);
  menu.append_section(null, primary);

  const organisation = new Gio.Menu();
  if (showMoveToTab)
    organisation.append(labels.moveToTab, `${namespace}.move-to-tab`);
  if (showWorkspaceTransfer) {
    organisation.append(labels.copyToWorkspace, `${namespace}.copy-to-workspace`);
    organisation.append(labels.moveToWorkspace, `${namespace}.move-to-workspace`);
  }
  organisation.append(labels.moveEarlier, `${namespace}.move-earlier`);
  organisation.append(labels.moveLater, `${namespace}.move-later`);
  menu.append_section(null, organisation);

  const destructive = new Gio.Menu();
  destructive.append(labels.remove, `${namespace}.remove`);
  menu.append_section(null, destructive);

  const popover = new Gtk.PopoverMenu({menu_model: menu});
  popover.insert_action_group(namespace, group);
  return new Gtk.MenuButton({
    icon_name: 'view-more-symbolic',
    tooltip_text: labels.menu,
    popover,
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
  });
}
