#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

fail() {
  printf 'FOUT: %s\n' "$1" >&2
  exit 1
}

for command in flatpak sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "Benodigd programma ontbreekt: $command"
done

VERSION="$(sed -n "s/^project('workspace-hub', version: '\([^']*\)'.*/\1/p" meson.build)"
[[ -n "$VERSION" ]] || fail 'De projectversie kon niet uit meson.build worden gelezen.'

BUNDLE_PATH="${1:-$PROJECT_ROOT/../workspace-hub-v${VERSION}.flatpak}"
CHECKSUM_PATH="$BUNDLE_PATH.sha256"
[[ -f "$BUNDLE_PATH" ]] || fail "Flatpakbundle niet gevonden: $BUNDLE_PATH"
[[ -f "$CHECKSUM_PATH" ]] || fail "SHA-256-sidecar ontbreekt: $CHECKSUM_PATH"

printf '%s\n' '=== SHA-256 ==='
(
  cd "$(dirname -- "$BUNDLE_PATH")"
  sha256sum -c "$(basename -- "$CHECKSUM_PATH")"
)

TMP_DIR="$(mktemp -d)"
TMP_REPO="$TMP_DIR/repo"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '\n%s\n' '=== Bundle-importcontrole ==='
flatpak build-import-bundle "$TMP_REPO" "$BUNDLE_PATH"

printf '\nCONTROLE GESLAAGD: checksum en importeerbaarheid van de Flatpakbundle zijn bevestigd.\n'
printf 'Voer de owner-installatietest afzonderlijk uit met:\n  flatpak install --user %q\n' "$BUNDLE_PATH"
