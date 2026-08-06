import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const app = new Gio.Application({
  application_id: 'io.github.christiaanbruinsma.WorkspaceHub.RunAsyncTest',
  flags: Gio.ApplicationFlags.NON_UNIQUE,
});

let promiseRan = false;
let timedOut = false;
let timeoutSourceId = 0;

app.connect('activate', () => {
  timeoutSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    timedOut = true;
    timeoutSourceId = 0;
    app.quit();
    return GLib.SOURCE_REMOVE;
  });

  Promise.resolve().then(() => {
    promiseRan = true;

    if (timeoutSourceId !== 0) {
      GLib.Source.remove(timeoutSourceId);
      timeoutSourceId = 0;
    }

    app.quit();
  });
});

const exitCode = await app.runAsync(['workspace-hub-run-async-test']);

if (exitCode !== 0)
  throw new Error(`runAsync returned unexpected exit code ${exitCode}`);

if (!promiseRan)
  throw new Error('Promise callback did not run while the application main loop was active');

if (timedOut)
  throw new Error('Promise callback ran only after the application timeout forced shutdown');
