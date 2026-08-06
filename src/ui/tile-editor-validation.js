export function tileEditorNameIsValid(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function syncTileEditorSaveResponse(dialog, titleRow, responseId = 'save') {
  const enabled = tileEditorNameIsValid(titleRow.get_text());
  dialog.set_response_enabled(responseId, enabled);
  return enabled;
}
