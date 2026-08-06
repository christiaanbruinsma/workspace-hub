import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

function stringModel(values) {
  return Gtk.StringList.new(values.map(value => String(value)));
}

/**
 * Present the libadwaita 1.5-compatible cross-workspace transfer dialog.
 *
 * The canonical Adw.AlertDialog.choose()/choose_finish() API provides one
 * completion path for both response activation and dismissal. Stable IDs stay
 * separate from translated labels and are read again only after a confirmed
 * response. Cleanup is executed exactly once from the async completion.
 */
export function presentTransferItemDialog({
  parent,
  mode,
  destinations,
  heading,
  body,
  workspaceLabel,
  tabLabel,
  cancelLabel,
  confirmLabel,
  onConfirm,
  onClosed = null,
  onError = null,
}) {
  if (!['copy', 'move'].includes(mode))
    throw new Error(`Unsupported transfer dialog mode: ${mode}`);
  if (!Array.isArray(destinations) || destinations.length === 0)
    throw new Error('At least one destination workspace is required');
  if (typeof onConfirm !== 'function')
    throw new Error('A transfer confirmation callback is required');

  const responseId = 'transfer';
  const workspaceRow = new Adw.ComboRow({
    title: workspaceLabel,
    model: stringModel(destinations.map(destination => destination.displayName)),
    selected: 0,
  });
  const tabRow = new Adw.ComboRow({title: tabLabel});
  const group = new Adw.PreferencesGroup();
  group.add(workspaceRow);

  const hasTabs = destinations.some(destination => destination.tabs.length > 0);
  if (hasTabs)
    group.add(tabRow);

  const dialog = new Adw.AlertDialog({
    heading,
    body,
    heading_use_markup: false,
    body_use_markup: false,
  });
  dialog.set_extra_child(group);
  dialog.add_response('cancel', cancelLabel);
  dialog.add_response(responseId, confirmLabel);
  dialog.set_response_appearance(responseId, Adw.ResponseAppearance.SUGGESTED);
  dialog.set_default_response(responseId);
  dialog.set_close_response('cancel');

  const selectedDestination = () => destinations[workspaceRow.get_selected()] ?? null;
  const selectedTab = destination => destination?.tabs?.[tabRow.get_selected()] ?? null;

  const updateState = () => {
    const destination = selectedDestination();
    if (hasTabs) {
      tabRow.set_model(stringModel((destination?.tabs ?? []).map(tab => tab.displayTitle)));
      tabRow.set_selected(0);
    }
    const tab = hasTabs ? selectedTab(destination) : null;
    dialog.set_response_enabled(
      responseId,
      Boolean(destination?.id) && (!hasTabs || Boolean(tab?.id))
    );
  };

  workspaceRow.connect('notify::selected', updateState);
  if (hasTabs) {
    tabRow.connect('notify::selected', () => {
      const destination = selectedDestination();
      const tab = selectedTab(destination);
      dialog.set_response_enabled(responseId, Boolean(destination?.id) && Boolean(tab?.id));
    });
  }
  updateState();

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

      const destination = selectedDestination();
      const tab = hasTabs ? selectedTab(destination) : null;
      if (!destination?.id || (hasTabs && !tab?.id))
        throw new Error('The selected transfer destination is no longer valid');

      onConfirm({
        destinationWorkspaceId: destination.id,
        destinationTabId: hasTabs ? tab.id : null,
      });
    });
  });

  return dialog;
}
