# Privacy, discovery and diagnostics

## Application discovery

Workspace Hub reads standard `.desktop` application metadata from read-only host locations for system packages, Flatpak, Snap and local user launchers. It also asks the host Flatpak command for the installed application ID, display name and installation scope using `flatpak list --app`. This inventory is read-only and does not expose application data. Workspace Hub does not inspect documents, accounts, mail content or browser profiles.

Default application suggestions are derived from standard `mimeapps.list` associations, such as the handler for `mailto:` and `https:`.

## Host application launching

Inside Flatpak, Workspace Hub has access to the `org.freedesktop.Flatpak` host command interface. This is a broad host bridge and is exposed transparently under Settings → Advanced.

Workspace Hub limits its own use of this bridge to fixed argument arrays. It lists installed Flatpak apps with:

```text
flatpak-spawn --host flatpak list --app --columns=application:full,name:full,installation:full
```

Confirmed Flatpak entries launch with the matching user/system installation scope. Other confirmed catalog entries use:

```text
flatpak-spawn --host gio launch <catalogued-desktop-file>
```

It does not execute raw profile text, the desktop file's `Exec` field, a shell, `bash -c` or user-supplied command arguments. It does not install, update or uninstall applications. Native builds use the same fixed Flatpak commands for Flatpak apps and GIO for other resolved desktop applications.

## Local workspace library

Workspace Hub stores workspace configuration locally in `~/.config/workspace-hub/workspace-library.json`. The library may contain multiple validated workspace profiles, the active workspace ID, archived-state metadata and the selected application language. It does not contain account passwords, tokens, browser sessions, document contents or network credentials.

When a legacy single-workspace file is found, `workspace-profile.json` is read as a migration source and wrapped in the current versioned library. Invalid local data is preserved with a timestamped filename before a safe fallback is created.

Before an archived workspace is permanently removed, Workspace Hub writes a local JSON safety copy to `~/.config/workspace-hub/deleted-workspaces`. These files contain the same workspace configuration as an exported profile and remain local until the user removes them manually or a future recovery workflow manages them.

## Workspace checks

Workspace Hub performs passive local checks for configured desktop applications and local folders. Website addresses are checked only for supported structure. Remote SMB and DAV locations are not contacted automatically.

A remote location is contacted only after the user explicitly chooses **Test** and confirms the action. Workspace Hub does not automatically mount the location and does not store credentials.

## Diagnostic exports

Diagnostic JSON may include Workspace Hub and operating-system version information, profile identity and schema, availability states, package-source labels and technical desktop application IDs.

Diagnostic JSON excludes passwords, tokens, browser cookies, document contents, URL query strings and fragments, complete email addresses and complete personal home paths. The app presents a preview before export.
