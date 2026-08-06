#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

fail() {
  printf 'FOUT: %s\n' "$1" >&2
  exit 1
}

[[ -f meson.build ]] || fail 'meson.build ontbreekt; start dit script vanuit de volledige Workspace Hub-projectmap.'
[[ -f debian/control ]] || fail 'debian/control ontbreekt; gebruik de volledige Workspace Hub-projectmap.'

for command in dpkg-buildpackage dpkg-checkbuilddeps dpkg-parsechangelog sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "Benodigd programma ontbreekt: $command. Volg docs/development/packaging.md onder Eenmalige voorbereiding."
done

printf 'Workspace Hub Debian package build\n'
printf 'Project: %s\n\n' "$PROJECT_ROOT"

if ! dpkg-checkbuilddeps; then
  cat >&2 <<'MSG'

Niet alle buildafhankelijkheden zijn geïnstalleerd.
Voer de eenmalige installatieopdracht uit docs/development/packaging.md uit en start dit script daarna opnieuw.
MSG
  exit 2
fi

VERSION="$(dpkg-parsechangelog -S Version)"
MESON_VERSION="$(sed -n "s/^project('workspace-hub', version: '\([^']*\)'.*/\1/p" meson.build)"
[[ -n "$MESON_VERSION" ]] || fail 'De projectversie kon niet uit meson.build worden gelezen.'
[[ "$VERSION" == "$MESON_VERSION" ]] || fail "Versiemismatch: debian/changelog=$VERSION, meson.build=$MESON_VERSION"

PACKAGE_PATH="$PROJECT_ROOT/../workspace-hub_${VERSION}_all.deb"
CHECKSUM_PATH="$PACKAGE_PATH.sha256"

rm -f -- "$PACKAGE_PATH" "$CHECKSUM_PATH"

printf '\nBouwen van Workspace Hub %s...\n' "$VERSION"
dpkg-buildpackage --build=binary --no-sign

[[ -f "$PACKAGE_PATH" ]] || fail "Het verwachte pakket is niet aangemaakt: $PACKAGE_PATH"

(
  cd "$(dirname -- "$PACKAGE_PATH")"
  sha256sum "$(basename -- "$PACKAGE_PATH")" > "$(basename -- "$CHECKSUM_PATH")"
)

printf '\nGEREED\n'
printf 'Debian package: %s\n' "$PACKAGE_PATH"
printf 'SHA-256:        %s\n' "$CHECKSUM_PATH"
printf '\nControleer het pakket met:\n  ./scripts/verify-deb.sh\n'
