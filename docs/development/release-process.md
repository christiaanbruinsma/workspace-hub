# Workspace Hub release process

## 1. Define the patch contract

Before editing code, record:

- the exact problem or capability;
- files and layers allowed to change;
- data or schema impact;
- runtime acceptance steps;
- explicit non-goals.

A focused bugfix or feature patch must not silently introduce unrelated refactors.

## 2. Implement against authoritative APIs

Use official GTK, libadwaita, GLib, freedesktop and packaging contracts. Keep presentation, validation, persistence and platform operations separated. Reject temporary hacks that would not survive external review.

## 3. Run source quality control

Required checks include:

- syntax and static contract tests;
- schema and migration tests where relevant;
- Meson installation completeness;
- metadata and licensing consistency;
- absence of shell interpolation and unnecessary permissions;
- review of all changed files against the patch scope.

## 4. Run execution quality control

Build and exercise the changed workflow in GNOME Builder on the target system. Normal use must be free of GTK, GJS and libadwaita warnings. Package changes additionally require Debian and Flatpak verification. Build and verify the public Flatpak asset with `scripts/build-flatpak.sh` and `scripts/verify-flatpak.sh` before the owner install test.

## 5. Prepare source and release artifacts

The source archive contains durable project files only:

```text
README.md
CHANGELOG.md
CONTRIBUTING.md
SECURITY.md
PRIVACY.md
LICENSE
THIRD-PARTY-NOTICES.md
docs/
data/
debian/
scripts/
src/
tests/
```

Version-specific evidence is delivered separately:

```text
workspace-hub-v<version>-release-evidence.zip
├── PATCH-CONTRACT-v<version>.md
├── TESTING-v<version>.md
├── RELEASE-CHECKLIST-v<version>.md
├── automated-test-results.txt
└── source-diff-summary.txt
```

Generated website output, local build directories, packages and temporary diagnostics do not belong in the source archive.

## 6. Verify the final archives

- regenerate `SHA256SUMS` inside the source tree;
- create deterministic archives with safe relative paths;
- write external SHA-256 sidecars;
- test archive integrity;
- extract into an empty directory;
- repeat the automated suite from that extraction;
- compare expected source and evidence contents.

## 7. Publish

A public release should include:

- source archive or repository tag;
- installable package assets;
- checksums;
- concise release notes;
- optional release-evidence archive.

Pushing source to GitHub does not replace creating a GitHub Release with the required installable assets.

## Release blockers

Do not mark a release stable when any of these remain:

- runtime warnings in normal workflows;
- unverified data migration;
- failing tests or invalid metadata;
- unexplained Lintian errors;
- hidden network or host-access changes;
- missing licenses or third-party notices;
- internal patch evidence accumulated in the source tree;
- behaviour that relies on undocumented or deprecated APIs.
