# Workspace Hub Profile and Library Schema

Workspace Hub separates the portable configuration of one workspace from the local library that can contain multiple workspaces.

## Workspace profile

Portable workspace profiles use:

```json
{
  "format": "workspace-hub-profile",
  "schema_version": 12
}
```

A profile contains one workspace's identity, dashboard settings, sections, items and status configuration. It does not contain application-wide settings such as the interface language.

Schema-10 profiles first migrate to schema 11 by moving `settings.language` out of the workspace profile. Schema-11 profiles then migrate to schema 12 by adding native section-tab state. Existing items are assigned to one General tab without content loss or reordering. When an existing local schema-10 profile is upgraded, its language is preserved in the workspace library's global `application_settings.language` field.

## Workspace library

The local multi-workspace container uses:

```json
{
  "format": "workspace-hub-library",
  "schema_version": 1,
  "active_workspace_id": "example-workspace",
  "application_settings": {
    "language": "system"
  },
  "workspaces": [
    {
      "id": "example-workspace",
      "archived": false,
      "profile": {
        "format": "workspace-hub-profile",
        "schema_version": 12
      }
    }
  ]
}
```

The library contract requires:

- at least one workspace;
- a maximum of 50 workspaces;
- unique workspace IDs;
- a valid active workspace ID;
- the active workspace not to be archived;
- every record ID to match `profile.profile.id`;
- a supported global language: `system`, `en`, `nl` or `de`.

The library is local application state. Exporting a workspace continues to produce a portable `workspace-hub-profile`, not the complete local library.


## Workspace lifecycle

Workspace records keep stable IDs while their display names can change. Embedded profiles use schema 12 and the library supports these operations:

- activate a non-archived workspace;
- add an independent workspace;
- rename a workspace while preserving its ID;
- duplicate a workspace under a new ID;
- reorder available or archived workspaces within their own group;
- archive only a non-active workspace;
- restore an archived workspace;
- remove only a non-active workspace.

The library must always contain at least one available workspace. Deleted workspace profiles are written to the local `deleted-workspaces` safety directory before the library record is removed. These safety copies are local recovery artifacts and are not part of portable workspace exports.

## Section tabs

Schema 12 stores section tabs under `settings.section_tabs` for Apps, Web apps, Files & places and Daily tools.

Example:

```json
{
  "settings": {
    "section_tabs": {
      "apps": {
        "tabs": [
          {
            "id": "general",
            "title": "General",
            "position": 1,
            "is_default": true
          }
        ],
        "active_tab_id": "general"
      }
    }
  },
  "sections": {
    "apps": [
      {
        "id": "email",
        "type": "application",
        "tab_id": "general"
      }
    ]
  }
}
```

Contract rules:

- every supported section contains between 1 and 20 tabs;
- tab IDs are unique within their section;
- exactly one tab is marked as the default;
- `active_tab_id` identifies an existing tab;
- every item in a tabbed section contains a valid `tab_id`;
- Help & support items do not contain `tab_id`;
- the default General tab cannot be removed;
- tab titles are limited to 80 characters.

The General title is translated by the interface while its stable ID remains `general`. Custom tab titles are user data and are displayed as entered.


Moving an item between tabs changes only `tab_id` and the tab-scoped `position`. The item ID, target, icon metadata, governance fields and enabled state remain unchanged. Both source and destination positions are renumbered without gaps. Moves are rejected for unknown sections, unknown tabs, the current tab and organisation-managed items. No schema migration is required for this operation.

## Application targets

Application items contain:

- `desktop_id` — the freedesktop desktop application ID;
- `application_source` — `system`, `flatpak-system`, `flatpak-user`, `snap`, `user`, `sandbox` or `unknown`;
- `icon_override` — `inherit`, `application` or `dashboard`.

The source disambiguates package variants. It is metadata, not an executable command.

## Dashboard and application icon policy

`settings.icon_style` is one of:

- `fluent-linux-color`;
- `fluent-linux-grey`;
- `fluent-ui-color`;
- `system`.

`settings.application_icon_policy` is one of:

- `application` — use each linked app's real icon; default;
- `dashboard` — use the selected dashboard set where a mapping exists.

Application-level `icon_override` values mean:

- `inherit` — follow `settings.application_icon_policy`;
- `application` — force the real application icon;
- `dashboard` — force the selected dashboard icon set.

If a dashboard mapping is unavailable, Workspace Hub falls back to the real application icon and then to a safe generic icon.

## Website icon roles

Website and web-app tiles store one semantic `icon_role` rather than an SVG filename:

```json
{
  "type": "web",
  "title": "Accounting",
  "url": "https://example.com",
  "icon_role": "accounting"
}
```

Supported roles are `web`, `accounting`, `people`, `board`, `calendar`, `document`, `mail`, `support`, `guide`, `apps`, `folder` and `backup`. Changing the global dashboard icon style changes the rendered artwork without modifying the profile. Workspace Hub does not download favicons.

## Compatibility and safety

Workspace Hub migrates supported older profile schemas before validation. A valid legacy single-workspace profile is wrapped in a versioned workspace library when multi-workspace storage is first initialized. The original legacy file remains available as a migration source and is not silently rewritten as a different format.

Unsupported future schemas are rejected. Invalid data is preserved with an `.invalid-<timestamp>.json` suffix before Workspace Hub creates a safe fallback. Imports are bounded and validated before application.

Profiles and libraries must not contain passwords, tokens, browser sessions, document contents, raw shell commands or stored network credentials.

## Cross-workspace transfer contract

Copy and Move use existing schema-12 item and tab fields; no schema migration is required.

- Copy leaves the source profile unchanged and appends an independent clone to the same section in the destination profile. The destination item always receives a new ID.
- Move removes the source item and appends it to the same section in the destination. Its ID is retained unless that ID exists anywhere in the complete destination profile.
- Tabbed sections require an existing destination `tab_id`; Help & support does not accept a tab ID.
- Only affected source and destination collections are position-normalised.
- The active workspace ID, workspace ordering, global application settings and unrelated profiles or sections remain unchanged.
- Changed source or destination profiles use the canonical local-ownership mutation contract.
- Both workspaces must be non-archived and the source item must not be locked.

The entire candidate workspace library validates as library schema 1 before persistence.
## Live transfer reconciliation

Cross-workspace Copy and Move do not add persisted fields. Controller generations, mutation ordering and post-commit view reconciliation are runtime-only concerns; profile schema 12 and workspace-library schema 1 remain unchanged.
