# Workspace Hub 0.9.0

Workspace Hub is a GNOME-native starting point for a Linux workday. It gives people familiar places for desktop applications, web apps, files, shared locations, workspace status and support.

## Current capabilities

- multiple independent workspaces;
- workspace create, switch, rename, duplicate, reorder, archive, restore and guarded delete;
- copy the complete configured contents of one workspace over another with a target restorepoint;
- reset the active workspace without changing its identity or any other workspace;
- add a fresh independent example workspace at any time;
- native section tabs for Apps, Web apps, Files & places and Daily tools;
- in-place tab rename, add, move and delete;
- move configured items between tabs with stable IDs and normalised ordering;
- copy or move items to the same section in another available workspace;
- local application discovery across desktop, Flatpak, Snap and user locations;
- dashboard context menus and keyboard access;
- active-workspace import and export, workspace-specific restorepoints and history;
- local diagnostics with privacy redaction;
- English, Dutch and German primary interface support;
- Flatpak development builds and native Debian packaging.

## Build in GNOME Builder

Open the complete project directory and select:

```text
io.github.christiaanbruinsma.WorkspaceHub.json
```

## Run automated tests

```bash
node --test tests/*.test.mjs
```

Meson also registers target-runtime GJS tests when `gjs` is available.

## Build the Flatpak release bundle

```bash
./scripts/build-flatpak.sh
./scripts/verify-flatpak.sh
```

Expected release assets:

```text
workspace-hub-v0.9.0.flatpak
workspace-hub-v0.9.0.flatpak.sha256
```

## Build the native Debian package

```bash
./scripts/build-deb.sh
./scripts/verify-deb.sh
```

Expected package names:

```text
workspace-hub_0.9.0_all.deb
workspace-hub_0.9.0_all.deb.sha256
```

See [Building and packaging](docs/development/packaging.md).

## Architecture and reviewability

Workspace Hub uses GTK 4, libadwaita and GJS. The local workspace library is authoritative for workspace identity and active selection; each embedded profile remains a portable validated workspace configuration.

Store mutations are serialised independently from GTK presentation work. Cross-workspace item transfers and complete workspace-content replacement validate stable IDs against the latest committed library, create restorepoints before persistence and publish live state only after a successful write. UI styling is scoped and follows the host theme.

See [Architecture](docs/development/architecture.md) and [Profile schema](docs/development/profile-schema.md).

## Documentation

- [Documentation home](docs/index.md)
- [Working with items and workspaces](docs/user-guide/workspace-items.md)
- [Keyboard shortcuts](docs/user-guide/keyboard-shortcuts.md)
- [Testing](docs/development/testing.md)
- [Release process](docs/development/release-process.md)
- [Changelog](CHANGELOG.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)
