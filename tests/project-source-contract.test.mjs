import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...walk(fullPath));
    else if (entry.isFile())
      files.push(fullPath);
  }
  return files;
}

function runtimeModules() {
  return walk(path.join(root, 'src'))
    .filter(file => file.endsWith('.js'))
    .map(file => path.relative(path.join(root, 'src'), file).replaceAll('\\', '/'));
}

test('public release identity is consistently Workspace Hub 0.9.0', () => {
  assert.match(read('meson.build'), /version: '0\.9\.0'/);
  assert.match(read('README.md'), /^# Workspace Hub 0\.9\.0/m);
  assert.match(read('data/io.github.christiaanbruinsma.WorkspaceHub.metainfo.xml'), /<release version="0\.9\.0"/);
  assert.match(read('debian/changelog'), /^workspace-hub \(0\.9\.0\)/);
});

test('application uses the async GJS entrypoint during its active main loop', () => {
  const source = read('src/main.js');
  assert.match(source, /await app\.runAsync\(/);
  assert.doesNotMatch(source, /\bapp\.run\s*\(/);
});

test('release configuration contains only public identity fields', () => {
  const config = read('src/config.js.in');
  assert.match(config, /export const APP_ID/);
  assert.match(config, /export const VERSION/);
  assert.match(config, /export const PKGDATADIR/);
  assert.equal(config.match(/export const /g)?.length, 3);

  const privateArtifactNames = walk(root)
    .map(file => path.basename(file))
    .filter(name => /(evidence|handback|candidate|probe|trace)/i.test(name));
  assert.deepEqual(privateArtifactNames, []);

  const application = read('src/application.js');
  assert.match(application, /\[Workspace Hub\]\[runtime\] version=\$\{VERSION\}/);
  assert.match(application, /version: VERSION/);
});

test('every runtime JavaScript module is installed by Meson', () => {
  const meson = read('src/meson.build');
  for (const relative of runtimeModules()) {
    const escaped = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(meson, new RegExp(escaped), relative);
  }
});

test('release metadata and launcher use the canonical application identity', () => {
  const appId = 'io.github.christiaanbruinsma.WorkspaceHub';
  const manifest = JSON.parse(read(`${appId}.json`));
  assert.equal(manifest['app-id'], appId);
  assert.equal(manifest.command, 'workspace-hub');
  assert.equal(manifest.runtime, 'org.gnome.Platform');
  assert.match(read(`data/${appId}.desktop.in`), /^Icon=@APP_ID@$/m);
  assert.match(read(`data/${appId}.metainfo.xml`), new RegExp(`<id>${appId}</id>`));
});

test('release source preserves modular domain, service and UI boundaries', () => {
  const required = [
    'src/services/profile-store.js',
    'src/services/library-mutation-queue.js',
    'src/services/library-transaction.js',
    'src/services/workspace-activation-coordinator.js',
    'src/services/workspace-item-transfer.js',
    'src/ui/transfer-view-reconciliation.js',
    'src/ui/tile-editor-validation.js',
  ];
  for (const relative of required)
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
});

test('public documentation is present without bundled private artifacts', () => {
  for (const relative of ['README.md', 'CHANGELOG.md', 'docs/index.md', 'docs/development/testing.md'])
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  const topLevel = fs.readdirSync(root);
  assert.equal(topLevel.some(name => /(evidence|handback|candidate)/i.test(name)), false);
});

test('public release includes reproducible Flatpak bundle and verification scripts', () => {
  const buildPath = path.join(root, 'scripts/build-flatpak.sh');
  const verifyPath = path.join(root, 'scripts/verify-flatpak.sh');
  assert.equal(fs.existsSync(buildPath), true);
  assert.equal(fs.existsSync(verifyPath), true);
  assert.notEqual(fs.statSync(buildPath).mode & 0o111, 0);
  assert.notEqual(fs.statSync(verifyPath).mode & 0o111, 0);

  const build = read('scripts/build-flatpak.sh');
  assert.match(build, /--default-branch=stable/);
  assert.match(build, /flatpak build-bundle/);
  assert.match(build, /workspace-hub-v\$\{VERSION\}\.flatpak/);
  assert.match(build, /sha256sum/);

  const verify = read('scripts/verify-flatpak.sh');
  assert.match(verify, /mktemp -d/);
  assert.match(verify, /flatpak build-import-bundle/);
  assert.doesNotMatch(verify, /remote-add|remote-delete/);

  const packaging = read('docs/development/packaging.md');
  assert.match(packaging, /Flatpak release bundle/);
  assert.match(packaging, /Flatpak permission rationale/);
});
