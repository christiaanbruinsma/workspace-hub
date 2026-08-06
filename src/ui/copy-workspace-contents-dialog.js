import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

function stringModel(values) {
  return Gtk.StringList.new(values.map(value => String(value)));
}

export function presentWorkspaceContentsDestinationDialog({
  parent,
  destinations,
  heading,
  body,
  workspaceLabel,
  cancelLabel,
  continueLabel,
  onSelect,
  onClosed = null,
  onError = null,
}) {
  if (!Array.isArray(destinations) || destinations.length === 0)
    throw new Error('At least one destination workspace is required');
  if (typeof onSelect !== 'function')
    throw new Error('A destination selection callback is required');

  const responseId = 'continue';
  const workspaceRow = new Adw.ComboRow({
    title: workspaceLabel,
    model: stringModel(destinations.map(destination => destination.displayName)),
    selected: 0,
  });
  const group = new Adw.PreferencesGroup();
  group.add(workspaceRow);

  const dialog = new Adw.AlertDialog({
    heading,
    body,
    heading_use_markup: false,
    body_use_markup: false,
  });
  dialog.set_extra_child(group);
  dialog.add_response('cancel', cancelLabel);
  dialog.add_response(responseId, continueLabel);
  dialog.set_response_appearance(responseId, Adw.ResponseAppearance.SUGGESTED);
  dialog.set_default_response(responseId);
  dialog.set_close_response('cancel');

  let completionHandled = false;
  const finish = callback => {
    if (completionHandled)
      return;
    completionHandled = true;
    try {
      callback?.();
    } catch (error) {
      onError?.(error);
    } finally {
      onClosed?.();
    }
  };

  dialog.choose(parent, null, (_source, result) => {
    finish(() => {
      const response = dialog.choose_finish(result);
      if (response !== responseId)
        return;
      const destination = destinations[workspaceRow.get_selected()] ?? null;
      if (!destination?.id)
        throw new Error('The selected destination workspace is no longer valid');
      onSelect(destination);
    });
  });

  return dialog;
}
