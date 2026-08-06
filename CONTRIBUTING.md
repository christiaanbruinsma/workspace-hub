# Contributing to Workspace Hub

Workspace Hub targets GNOME, GTK 4 and libadwaita and is developed primarily on Zorin OS. Contributions should preserve a calm, native experience for non-technical Linux users.

## Before changing code

1. Open an issue or describe the focused patch scope.
2. Identify the authoritative GTK, libadwaita, GLib or freedesktop API involved.
3. State whether the profile schema, permissions, packaging or user data can change.
4. Keep unrelated refactors outside the patch.

## Code expectations

- Keep UI, service, persistence and validation responsibilities separated.
- Prefer focused modules and explicit contracts.
- Do not use shell interpolation, `eval`, `bash -c` or unnecessary elevated access.
- Do not hardcode Zorin colours or globally override GTK widgets.
- Render dynamic metadata as plain text unless markup is strictly controlled.
- Preserve keyboard access, translations and native accessibility behaviour.
- Treat GTK, GJS and libadwaita warnings as release blockers.

## Validation

Run:

```bash
node --test tests/*.test.mjs
```

Then build and test the affected workflow in GNOME Builder with the application log visible. Packaging changes must also pass the Debian verification scripts and relevant Flatpak checks.

See [Testing](docs/development/testing.md), [Architecture](docs/development/architecture.md) and [Release process](docs/development/release-process.md).

## Documentation

Durable public documentation belongs under `docs/`. Version-specific patch contracts, test results and release checklists belong in a release-evidence artifact and must not accumulate in the project root.
