# Workspace Hub architecture

## Purpose

Workspace Hub gives non-technical Linux users one familiar place for desktop applications, web apps, files, shared locations, workspace status and support. The application is GNOME-native and keeps user configuration local and portable.

## Main layers

```text
src/application.js
└── application lifecycle and actions

src/window.js
└── GTK/libadwaita presentation and interaction orchestration

src/ui/
├── compact native item action menus
└── focused move-to-tab dialog construction

src/services/
├── application and Flatpak discovery
├── availability and diagnostics
├── profile and workspace-library contracts
├── profile persistence and migration
├── workspace and section-tab operations
├── icons, translations and readiness
└── governance and health history
```

UI code must not duplicate validation or persistence rules owned by service contracts. New functionality should be added to an existing focused service or a new small module rather than expanding unrelated window logic.

## Data authority

```text
workspace-hub-library
├── application_settings
│   └── language
├── active_workspace_id
└── workspaces
    ├── record.id
    ├── record.archived
    └── record.profile
        └── portable workspace-hub-profile
```

The local workspace library is authoritative for workspace existence, order, archived state and active selection. Each embedded profile remains a validated portable workspace configuration.

Global application data includes interface language, the active workspace ID, workspace order and archived state. Workspace-owned data includes identity, appearance, section visibility, tiles, support configuration, diagnostics configuration and managed-item state.

## Persistence and migration

`ProfileStore` exposes the active workspace profile to the UI and owns reads, validation, migrations and atomic writes. Legacy single-workspace data is migrated into a workspace library without intentionally changing tiles, ordering, profile identity or governance data.

Profile schema 12 adds workspace-scoped section tabs. Unsupported or inconsistent data must fail validation rather than being silently accepted. File-size limits are checked before parsing.

## Workspace lifecycle

Workspace management supports create, example-workspace creation, activate, rename, duplicate, complete content replacement, reorder, archive, restore and guarded deletion.

- IDs are stable and independent of visible names.
- Duplicates are deep independent copies.
- The active workspace cannot be archived or deleted.
- Deletion requires prior archiving.
- A JSON safety copy is written before deleting a workspace record.
- Application language remains global.

## Section tabs

Apps, Web apps, Files & places and Daily tools use native `Gtk.Notebook` instances. Help & support, Workspace status and Settings remain untabbed.

Each supported section:

- always contains one protected default tab;
- stores ordered stable tab IDs and one active tab ID;
- scopes item positions and `tab_id` assignments to the workspace and section;
- supports native keyboard interaction and controlled reordering;
- explicitly disables tab detachment;
- limits a section to 20 tabs and tab titles to 80 characters;
- rejects duplicate names case-insensitively.

The notebook is the native interaction and accessibility layer. The dashboard panel is the only visual content surface. Styling is scoped through the `section-notebook` class and must not override every `Gtk.Notebook` globally.

Normal tab titles use their natural width. Titles longer than 24 characters are capped, end-ellipsized and expose the complete title as a tooltip. Active tabs use a restrained inset underline while inactive and hover states remain visually secondary to tiles.

## Live tab updates

Tab management mutates the existing notebook rather than rebuilding the complete page:

```text
Rename  → update the existing Gtk.Label
Add     → Gtk.Notebook.append_page()
Move    → Gtk.Notebook.reorder_child()
Delete  → Gtk.Notebook.remove_page()
```

When a deleted tab transfers items, only the destination tab content is refreshed. Programmatic mutations suppress duplicate selection and order writes. A stale UI controller may fall back to navigation, but the normal live path must not rebuild the page.

Configured items can also move between existing tabs in the same section. `workspace-items.js` owns the validated mutation: stable item identity and metadata are preserved, managed items are rejected, and source and destination positions are normalised. The window orchestrates persistence and refreshes only the two affected notebook pages. The destination selector and collection-row action menu live in focused `src/ui/` modules so GTK construction does not expand unrelated window logic.

## Dialog lifecycle

Single-value naming dialogs use `Gtk.Entry`. Confirmation remains disabled for empty, duplicate or unchanged values. Mutations that affect the active view are sequenced after the dialog closes and on the next idle cycle where required. A dialog callback must never manipulate stale widgets without first validating its live controller.

## Application discovery and launching

Application discovery reads freedesktop desktop launchers from supported system, Flatpak, Snap and user locations. Confirmed Flatpak applications launch by validated application ID. The application does not install, update or remove software.

Launch logic must not use shell interpolation, `eval`, `bash -c` or unvalidated command strings.

## Diagnostics and privacy

Availability checks are local by default. Remote shares and websites are not contacted automatically. Diagnostic exports remove URL query strings, redact email addresses and shorten home-directory paths. Dynamic metadata is rendered as plain text rather than Pango markup.

## Reviewability rules

- Use official GTK, libadwaita, GLib and freedesktop APIs.
- Keep UI, validation, persistence and platform operations separated.
- Prefer focused modules with explicit contracts over global helpers.
- Do not add theme-specific hardcoded colours or global widget overrides.
- Do not add permissions, host access or network behaviour without a documented need.
- Normal workflows must remain free of GTK, GJS and libadwaita warnings.


## Complete workspace content replacement

`workspace-contents-copy.js` owns the pure domain operation. It deep-clones a validated library, copies the source profile's settings, sections and status as one consistent snapshot, and preserves the complete target `profile` identity object and workspace archive state. The source, all unrelated workspaces, the active workspace ID and global application settings remain unchanged.

`ProfileStore.copyWorkspaceContents()` executes one queued library transaction. The target's pre-mutation profile is written as its restorepoint before persistence, and the resulting target profile receives one workspace-specific history entry after a successful commit. Archived source or target workspaces and source-to-self requests fail closed. GTK only selects stable destination IDs, presents a separate destructive confirmation and refreshes the current page after the store promise settles; the operation never activates the target automatically.

## Cross-workspace item transfers

Cross-workspace transfers are complete workspace-library transactions rather than separate source and destination profile writes. `workspace-item-transfer.js` is a pure domain operation: it validates stable IDs against a freshly read library, deep-clones the complete input, mutates only affected collections and returns a validated candidate plus transfer metadata. It never mutates the input library.

`ProfileStore` serialises all library mutations through one canonical store-only queue. The queued callback reads the latest disk library and ETag, rebuilds the candidate, creates all required pre-mutation restorepoints, performs one ETag-guarded replacement and publishes the new live state only after persistence succeeds. History records follow publication and can return a history-only warning without rolling back a valid commit. GTK rebuilds and toasts run only after the store promise has settled, so presentation work never blocks the mutation queue. Repeated activation of the same destination workspace is deduplicated. Frequent view-state writes use one per-workspace drain promise: callers share that promise, newer values replace older pending values, and the promise settles only after the latest submitted state has been committed. Failed drains release their per-workspace slot so a later save can retry without restarting the application.

Queued profile writes use a three-way merge over the call-time baseline, requested profile and latest committed profile. Independent changes are retained; concurrent changes to the same scalar or collection fail closed instead of overwriting newer data. Workspace create, example-workspace creation, rename, duplicate, complete content replacement, archive, reorder, remove, activate, profile save, view-state save, import and transfer retain their validation, restorepoint, history and return contracts while sharing the same mutation ordering boundary.

After a successful Copy or Move commit, the window reads the active workspace again and reconciles only the visible affected collection. A live notebook controller is usable only when its workspace ID, page ID, section ID and view generation match the current view and it has not been disposed. A matching controller replaces only the affected notebook page; a missing or stale controller triggers one controlled rebuild of the currently visible affected page. Copy leaves a visible source collection unchanged, Move removes the item immediately from a visible source, and either operation refreshes a destination that is active when the commit completes.

Copy creates an independent destination item with a new ID. Move retains the original ID when it is free across the complete destination profile and otherwise uses bounded collision-safe generation. Both operations stay within the same section; Help & support has no destination tab. Archived workspaces and managed items fail closed below the UI layer.
