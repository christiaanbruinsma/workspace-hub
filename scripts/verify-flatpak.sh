#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

fail() {
  printf 'FOUT: %s\n' "$1" >&2
  exit 1
}

for command in diff flatpak ostree sed sha256sum sort; do
  command -v "$command" >/dev/null 2>&1 || fail "Benodigd programma ontbreekt: $command"
done

VERSION="$(sed -n "s/^project('workspace-hub', version: '\([^']*\)'.*/\1/p" meson.build)"
[[ -n "$VERSION" ]] || fail 'De projectversie kon niet uit meson.build worden gelezen.'

MANIFEST_PATH="$PROJECT_ROOT/io.github.christiaanbruinsma.WorkspaceHub.json"
APP_ID="$(sed -n 's/^[[:space:]]*"app-id":[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH")"
[[ -n "$APP_ID" ]] || fail 'De app-ID kon niet uit het Flatpakmanifest worden gelezen.'

ARCH="$(flatpak --default-arch)"
BRANCH='stable'
EXPECTED_REF="app/$APP_ID/$ARCH/$BRANCH"

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
ostree init --repo="$TMP_REPO" --mode=archive

IMPORT_STDERR="$TMP_DIR/import.stderr"

if ! flatpak build-import-bundle \
  --no-update-summary \
  "$TMP_REPO" \
  "$BUNDLE_PATH" \
  2>"$IMPORT_STDERR"; then
  cat "$IMPORT_STDERR" >&2
  fail 'De Flatpakbundle kon niet in de tijdelijke repository worden geïmporteerd.'
fi

# Flatpak 1.14.x kan na een succesvolle import precies deze bekende
# GLib/OSTree-meldingen schrijven. Iedere andere stderr-uitvoer blijft fataal.
if [[ -s "$IMPORT_STDERR" ]]; then
  NORMALIZED_STDERR="$TMP_DIR/import.stderr.normalized"
  EXPECTED_STDERR="$TMP_DIR/import.stderr.expected"

  sed -E \
    "s/^\(flatpak build-import-bundle:[0-9]+\): (GLib|OSTree)-CRITICAL \\*\\*: [0-9:.]+: //" \
    "$IMPORT_STDERR" \
    | sed '/^[[:space:]]*$/d' \
    | sort \
    > "$NORMALIZED_STDERR"

  cat > "$EXPECTED_STDERR" <<'EOF'
g_str_has_prefix: assertion 'str != NULL' failed
_ostree_repo_get_remote: assertion 'name != NULL' failed
g_propagate_error: assertion 'src != NULL' failed
EOF
  sort -o "$EXPECTED_STDERR" "$EXPECTED_STDERR"

  if ! diff -u "$EXPECTED_STDERR" "$NORMALIZED_STDERR"; then
    cat "$IMPORT_STDERR" >&2
    fail 'De bundle-import produceerde onverwachte stderr-uitvoer.'
  fi

  printf '%s\n'     'Bekende Flatpak 1.14.x-importmeldingen herkend; aanvullende repositorycontroles worden uitgevoerd.'
fi

IMPORTED_COMMIT=''

while IFS=$'\t' read -r ref revision; do
  if [[ "$ref" == "$EXPECTED_REF" ]]; then
    IMPORTED_COMMIT="$revision"
    break
  fi
done < <(ostree refs --repo="$TMP_REPO" --list --revision)

[[ -n "$IMPORTED_COMMIT" ]] || fail "De verwachte ref ontbreekt na import: $EXPECTED_REF"

printf 'Geïmporteerde ref: %s\n' "$EXPECTED_REF"
printf 'Geïmporteerde commit: %s\n' "$IMPORTED_COMMIT"

printf '\n%s\n' '=== OSTree-consistentiecontrole ==='
ostree fsck --repo="$TMP_REPO" --quiet

printf '\nCONTROLE GESLAAGD: checksum, importeerbaarheid, ref en repositoryconsistentie zijn bevestigd.\n'
printf 'Voer de owner-installatietest afzonderlijk uit met:\n  flatpak install --user %q\n' "$BUNDLE_PATH"
