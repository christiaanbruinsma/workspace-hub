# Building and packaging Workspace Hub

Workspace Hub supports the GNOME Builder Flatpak development workflow and a native Debian package route.

## Development build

Open the project root in GNOME Builder and use:

```text
io.github.christiaanbruinsma.WorkspaceHub.json
```

The Flatpak development build uses the selected GNOME runtime and upstream libadwaita appearance.

## Flatpak release bundle

Install Flatpak, `flatpak-builder` and the GNOME 46 SDK/runtime before the first release build. From the project root, create the stable repository export and single-file bundle with:

```bash
./scripts/build-flatpak.sh
./scripts/verify-flatpak.sh
```

Expected output one directory above the project root:

```text
workspace-hub-v0.9.0.flatpak
workspace-hub-v0.9.0.flatpak.sha256
```

The verifier checks the checksum and imports the bundle into a temporary local repository. It does not install or modify the user's configured Flatpak remotes. Complete the owner test separately:

```bash
flatpak install --user ../workspace-hub-v0.9.0.flatpak
flatpak run io.github.christiaanbruinsma.WorkspaceHub
```

Use `flatpak install --user --reinstall` for a deliberate reinstall or upgrade test of the same bundle.

### Flatpak permission rationale

Workspace Hub is a local launcher and workspace organiser. It needs read-only visibility of desktop-entry and icon exports from the host, user, Flatpak and Snap locations so it can discover applications without copying their metadata. `home:ro` and `host-os:ro` support user-defined files/places and host application discovery while preventing writes through those broad mounts. The `org.freedesktop.Flatpak` D-Bus permission is used only for fixed, argument-array Flatpak operations; no shell command strings are constructed. Network access is not requested. Review these permissions again before every public release and document any change in `PRIVACY.md` and `CHANGELOG.md`.

## Native Debian package

The native package uses GTK 4 and libadwaita from the host system. Zorin OS can therefore apply its host colour scheme while Ubuntu and Debian use their normal system styling. Workspace Hub does not hardcode Zorin colours.

`Architecture: all` is valid because the package contains GJS, JavaScript, CSS, metadata and SVG assets without architecture-specific binaries.

### Build dependencies

```bash
sudo apt install \
  build-essential \
  debhelper \
  dpkg-dev \
  meson \
  ninja-build \
  gjs \
  nodejs \
  gir1.2-adw-1 \
  gir1.2-glib-2.0 \
  gir1.2-gtk-4.0 \
  gir1.2-pango-1.0 \
  hicolor-icon-theme \
  lintian \
  desktop-file-utils \
  appstream
```

### Build

From the project root:

```bash
./scripts/build-deb.sh
```

The script checks required tools and build dependencies, confirms that the Meson and Debian versions match, builds the binary package without signing and writes a SHA-256 sidecar.

Expected output one directory above the project root:

```text
workspace-hub_<version>_all.deb
workspace-hub_<version>_all.deb.sha256
workspace-hub_<version>_all.buildinfo
workspace-hub_<version>_all.changes
```

### Verify

```bash
./scripts/verify-deb.sh
```

The verifier checks package metadata, contents and checksum. When installed, `desktop-file-validate`, `appstreamcli` and `lintian` are also used. Lintian errors block release; warnings require explicit review.

### Install or upgrade

```bash
sudo apt install ./workspace-hub_<version>_all.deb
```

APT treats a newer version as an upgrade. User profiles in the personal configuration directory are not replaced by package upgrades.

### Reinstall

```bash
sudo apt install --reinstall ./workspace-hub_<version>_all.deb
```

### Remove

```bash
sudo apt remove workspace-hub
```

Package removal does not automatically erase personal profiles or history.

## Distribution boundaries

Use one distribution form at a time on a test machine. Do not run the Builder/Flatpak and native instances simultaneously because they share the same application ID.

The current Debian source format is `3.0 (native)` for local reproducible builds. Before publishing through an official Debian or Ubuntu repository, reassess the upstream tarball, Debian revision and repository-policy strategy.

## Installed documentation

The Debian package installs only end-user and legal project documents. Developer guides, website assets, release checklists and test evidence remain in the source repository or release artifacts and are not installed under `/usr/share/doc`.
