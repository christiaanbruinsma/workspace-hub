#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

fail() {
  printf 'FOUT: %s\n' "$1" >&2
  exit 1
}

for command in dpkg-deb dpkg-parsechangelog; do
  command -v "$command" >/dev/null 2>&1 || fail "Benodigd programma ontbreekt: $command"
done

VERSION="$(dpkg-parsechangelog -S Version)"
DEB_PATH="${1:-$PROJECT_ROOT/../workspace-hub_${VERSION}_all.deb}"
CHECKSUM_PATH="$DEB_PATH.sha256"

[[ -f "$DEB_PATH" ]] || fail "Pakket niet gevonden: $DEB_PATH. Bouw het eerst met ./scripts/build-deb.sh"

PACKAGE_NAME="$(dpkg-deb --field "$DEB_PATH" Package)"
PACKAGE_VERSION="$(dpkg-deb --field "$DEB_PATH" Version)"
PACKAGE_ARCH="$(dpkg-deb --field "$DEB_PATH" Architecture)"
[[ "$PACKAGE_NAME" == 'workspace-hub' ]] || fail "Onverwachte pakketnaam: $PACKAGE_NAME"
[[ "$PACKAGE_VERSION" == "$VERSION" ]] || fail "Versiemismatch: pakket=$PACKAGE_VERSION, project=$VERSION"
[[ "$PACKAGE_ARCH" == 'all' ]] || fail "Onverwachte architectuur: $PACKAGE_ARCH"

printf '%s\n' '=== Pakketmetadata ==='
dpkg-deb --info "$DEB_PATH"

printf '\n%s\n' '=== Belangrijkste velden ==='
dpkg-deb --showformat='Package: ${Package}\nVersion: ${Version}\nArchitecture: ${Architecture}\nDepends: ${Depends}\n' --show "$DEB_PATH"

printf '\n%s\n' '=== Pakketinhoud ==='
dpkg-deb --contents "$DEB_PATH"

if [[ -f "$CHECKSUM_PATH" ]]; then
  printf '\n%s\n' '=== SHA-256 ==='
  (
    cd "$(dirname -- "$DEB_PATH")"
    sha256sum -c "$(basename -- "$CHECKSUM_PATH")"
  )
else
  printf '\nWAARSCHUWING: SHA-256-sidecar ontbreekt: %s\n' "$CHECKSUM_PATH" >&2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

dpkg-deb --extract "$DEB_PATH" "$TMP_DIR"
[[ -x "$TMP_DIR/usr/bin/workspace-hub" ]] || fail '/usr/bin/workspace-hub ontbreekt of is niet uitvoerbaar.'
[[ -f "$TMP_DIR/usr/share/workspace-hub/main.js" ]] || fail 'main.js ontbreekt in het pakket.'
[[ -f "$TMP_DIR/usr/share/workspace-hub/services/workspace-library-contract.js" ]] || fail 'workspace-library-contract.js ontbreekt in het pakket.'
[[ -f "$TMP_DIR/usr/share/applications/io.github.christiaanbruinsma.WorkspaceHub.desktop" ]] || fail 'Desktop-entry ontbreekt.'
[[ -f "$TMP_DIR/usr/share/metainfo/io.github.christiaanbruinsma.WorkspaceHub.metainfo.xml" ]] || fail 'AppStream-metainfo ontbreekt.'
[[ -f "$TMP_DIR/usr/share/icons/hicolor/scalable/apps/io.github.christiaanbruinsma.WorkspaceHub.svg" ]] || fail 'Applicatie-icoon ontbreekt.'

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$TMP_DIR/usr/share/applications/io.github.christiaanbruinsma.WorkspaceHub.desktop"
else
  printf '\nINFO: desktop-file-validate niet geïnstalleerd; desktop-entryvalidatie overgeslagen.\n'
fi

if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net "$TMP_DIR/usr/share/metainfo/io.github.christiaanbruinsma.WorkspaceHub.metainfo.xml"
else
  printf '\nINFO: appstreamcli niet geïnstalleerd; AppStream-validatie overgeslagen.\n'
fi

if command -v lintian >/dev/null 2>&1; then
  printf '\n%s\n' '=== Lintian ==='
  lintian "$DEB_PATH"
else
  printf '\nINFO: lintian niet geïnstalleerd; Lintian-controle overgeslagen.\n'
fi

printf '\nCONTROLE GESLAAGD: pakketstructuur en kernbestanden zijn aanwezig.\n'
