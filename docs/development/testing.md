# Workspace Hub testing

## Quality gates

Every patch must pass two separate controls before delivery:

1. source and syntax validation;
2. execution and package validation.

Static success never replaces runtime acceptance on the target GNOME/Zorin environment.

## Automated checks

Run the complete Node test suite from the project root:

```bash
node --test tests/*.test.mjs
```

Also verify:

- JavaScript syntax for every runtime and test module;
- shell syntax for maintained scripts;
- AppStream XML validity;
- desktop-entry validity when the validator is available;
- Debian changelog and package metadata;
- Meson installation coverage for every runtime module;
- internal checksums;
- archive integrity and path safety;
- the full automated suite from a fresh extraction.

## Runtime acceptance

Keep the GNOME Builder application log visible and stop at the first unexpected message.

Required normal-workflow result:

```text
Gtk-CRITICAL ........ none
Gtk-WARNING ......... none
Gjs-WARNING ......... none
libadwaita warning .. none
data loss ........... none
```

## Regression for latest view-state persistence

1. create at least three tabs in one section;
2. switch rapidly from the first tab to the second and immediately to the third;
3. wait for the UI to become idle;
4. restart Workspace Hub;
5. confirm the third, last-selected tab remains active;
6. repeat once after a simulated or real recoverable save failure and confirm the next selection persists.

The persisted result must always be the latest submitted view state. No pending per-workspace drain may remain after success or failure.

## Regression for live section tabs

On Overview and on each dedicated collection page:

1. rename a tab repeatedly;
2. add and activate a tab;
3. move it through context-menu and drag paths;
4. delete an empty tab;
5. delete a non-empty tab and explicitly transfer its items;
6. restart and verify title, order, active tab and assignments.

These operations must not flash or rebuild the complete page in the normal live-controller path.


## Regression for item moves between tabs

On Overview and on each dedicated tabbed collection page:

1. move the first, middle and last item to another populated tab;
2. move an item to an empty tab;
3. move the last remaining source item so the source becomes empty;
4. confirm the active source tab remains selected;
5. verify source and destination ordering has no gaps;
6. restart and verify persistence;
7. restore the generated restorepoint through Workspace History and verify the selected active workspace version is restored;
8. confirm managed items cannot be moved;
9. repeat with long tab names and in English, Dutch and German;
10. use keyboard focus to open the collection-row action menu.

The normal live-controller path may replace only the source and destination notebook pages. It must not rebuild the complete Overview or collection page.

## Package acceptance

For a release build:

- build the native Debian package;
- verify checksum, metadata and installed contents;
- test clean install, upgrade, reinstall and removal;
- confirm user data survives upgrade and package removal;
- build and run the Flatpak development manifest;
- inspect permissions and host access;
- confirm packaged documentation contains no internal release evidence.

## Evidence

Version-specific test results, release checklists and patch contracts belong in a separate release-evidence artifact. Durable test policy stays in this document. Historical evidence is available from Git history and release assets rather than copied into every later source archive.

## Regression for cross-workspace Copy and Move

From Overview and every supported collection page:

1. copy an item into an empty and a populated destination tab;
2. move the first, middle and last item;
3. test Help & support without a tab selector;
4. test duplicate workspace names and confirm the stable destination ID is used;
5. archive or remove a destination, or remove its selected tab, before final confirmation and verify fail-closed validation;
6. double-activate the same action and verify one transfer;
7. queue two different transfers and verify the second uses the latest committed library;
8. force restorepoint, persistence and history failures and verify their distinct outcomes;
9. verify both race orders: transfer commit before activation, and activation commit before transfer;
10. after Copy, stay on the source and verify that its collection remains unchanged;
11. after Move, stay on the source and verify that the item disappears immediately;
12. switch to the destination immediately after confirmation and again after the success toast; the transferred item must appear without restarting;
13. verify a current generated controller uses targeted refresh and a stale or missing controller uses one controlled current-page fallback;
14. restart and verify persistence, restorepoints and workspace-specific history;
15. repeat in English, Dutch and German with keyboard-only dialog operation.

A failed restorepoint or persistence step must leave both disk and live state unchanged and write no history. A history failure occurs only after a successful commit and must be reported as a completed transfer with a history warning. Store mutation promises must settle before any GTK reconciliation begins. Copy must not rebuild a visible source page. Move must refresh the visible source collection, and Copy or Move must refresh a destination that is active at completion. A fallback is allowed only for the currently visible affected page and must preserve active workspace and page. An application restart must never be required to observe a committed transfer.

## Regression for complete workspace content replacement

1. choose a populated source and an empty target;
2. repeat with a populated target and confirm the destructive warning names both workspaces;
3. verify all apps, web apps, files, tools, support items, tabs, active-tab choices, visibility and appearance match the source;
4. verify target ID, name, organisation, revision, management metadata and archive identity are unchanged;
5. verify the source and an unrelated third workspace are byte-content unchanged;
6. verify the active workspace does not switch and the current page remains selected;
7. verify duplicate visible workspace names are disambiguated by stable IDs;
8. verify archived source, archived target and source-to-self requests fail closed;
9. force restorepoint and persistence failures and verify the target is not partially published;
10. open the target's Workspace History and restore the pre-overwrite version;
11. restart and verify both the overwrite and the restored version persist;
12. repeat in English, Dutch and German with keyboard-only selection and confirmation.
