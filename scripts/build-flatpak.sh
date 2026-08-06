#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

fail() {
  printf 'FOUT: %s\n' "$1" >&2
  exit 1
}

MANIFEST='io.github.christiaanbruinsma.WorkspaceHub.json'
[[ -f "$MANIFEST" ]] || fail "Flatpakmanifest ontbreekt: $MANIFEST"
[[ -f meson.build ]] || fail 'meson.build ontbreekt; gebruik de volledige Workspace Hub-projectmap.'

for command in flatpak flatpak-builder python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "Benodigd programma ontbreekt: $command"
done

VERSION="$(sed -n "s/^project('workspace-hub', version: '\([^']*\)'.*/\1/p" meson.build)"
[[ -n "$VERSION" ]] || fail 'De projectversie kon niet uit meson.build worden gelezen.'

APP_ID="$(python3 - "$MANIFEST" <<'PY'
import json
import sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
print(manifest.get('app-id', ''))
PY
)"
[[ -n "$APP_ID" ]] || fail 'De app-id ontbreekt in het Flatpakmanifest.'

BUILD_DIR="$PROJECT_ROOT/_flatpak-build"
REPO_DIR="$PROJECT_ROOT/_flatpak-repo"
BUNDLE_PATH="$PROJECT_ROOT/../workspace-hub-v${VERSION}.flatpak"
CHECKSUM_PATH="$BUNDLE_PATH.sha256"
RUNTIME_REPO='https://dl.flathub.org/repo/flathub.flatpakrepo'

rm -rf -- "$BUILD_DIR" "$REPO_DIR"
rm -f -- "$BUNDLE_PATH" "$CHECKSUM_PATH"

printf 'Workspace Hub Flatpak build\n'
printf 'Project: %s\n' "$PROJECT_ROOT"
printf 'Versie:  %s\n' "$VERSION"
printf 'App ID:  %s\n\n' "$APP_ID"

flatpak-builder \
  --force-clean \
  --repo="$REPO_DIR" \
  --default-branch=stable \
  "$BUILD_DIR" \
  "$MANIFEST"

flatpak build-bundle \
  --runtime-repo="$RUNTIME_REPO" \
  "$REPO_DIR" \
  "$BUNDLE_PATH" \
  "$APP_ID" \
  stable

[[ -f "$BUNDLE_PATH" ]] || fail "De verwachte Flatpakbundle is niet aangemaakt: $BUNDLE_PATH"

(
  cd "$(dirname -- "$BUNDLE_PATH")"
  sha256sum "$(basename -- "$BUNDLE_PATH")" > "$(basename -- "$CHECKSUM_PATH")"
)

printf '\nGEREED\n'
printf 'Flatpakbundle: %s\n' "$BUNDLE_PATH"
printf 'SHA-256:      %s\n' "$CHECKSUM_PATH"
printf '\nControleer de bundle met:\n  ./scripts/verify-flatpak.sh\n'
