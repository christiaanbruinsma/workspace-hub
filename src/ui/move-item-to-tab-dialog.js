import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * Present a single-choice destination dialog and invoke onConfirm only after
 * the dialog has fully closed. Destination IDs stay separate from translated
 * display titles so persistence never depends on user-facing text.
 */
export function presentMoveItemToTabDialog({
  parent,
  destinations,
  heading,
  body,
  destinationLabel,
  cancelLabel,
  moveLabel,
  onConfirm,
}) {
  if (!Array.isArray(destinations) || destinations.length === 0)
    throw new Error('At least one destination tab is required');

  const destinationModel = Gtk.StringList.new(destinations.map(destination => destination.title));
  const destinationRow = new Adw.ComboRow({
    title: destinationLabel,
    model: destinationModel,
    selected: 0,
  });
  const group = new Adw.PreferencesGroup();
  group.add(destinationRow);

  const dialog = new Adw.AlertDialog({
    heading,
    body,
    heading_use_markup: false,
    body_use_markup: false,
  });
  dialog.set_extra_child(group);
  dialog.add_response('cancel', cancelLabel);
  dialog.add_response('move', moveLabel);
  dialog.set_response_appearance('move', Adw.ResponseAppearance.SUGGESTED);
  dialog.set_default_response('move');
  dialog.set_close_response('cancel');

  let confirmedDestinationId = null;
  dialog.connect('response', (_dialog, response) => {
    if (response !== 'move')
      return;
    confirmedDestinationId = destinations[destinationRow.get_selected()]?.id ?? null;
  });
  dialog.connect('closed', () => {
    if (confirmedDestinationId === null)
      return;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      onConfirm(confirmedDestinationId);
      return GLib.SOURCE_REMOVE;
    });
  });
  dialog.present(parent);
  return dialog;
}
