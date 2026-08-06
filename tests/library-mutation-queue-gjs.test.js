import GLib from 'gi://GLib';
import {LibraryMutationQueue} from '../src/services/library-mutation-queue.js';

const loop = new GLib.MainLoop(null, false);
const queue = new LibraryMutationQueue();
const order = [];
let releaseFirst;
let failure = null;
let timeoutActive = true;
const gate = new Promise(resolve => { releaseFirst = resolve; });

const first = queue.enqueue('first', async () => {
  order.push('first-start');
  await gate;
  order.push('first-end');
  return 'first';
});
const second = queue.enqueue('second', () => {
  order.push('second');
  return 'second';
});

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
  try {
    if (JSON.stringify(order) !== JSON.stringify(['first-start']))
      throw new Error(`Unexpected queue order before release: ${order.join(',')}`);
    releaseFirst();
  } catch (error) {
    failure = error;
    releaseFirst();
  }
  return GLib.SOURCE_REMOVE;
});

Promise.all([first, second]).then(values => {
  try {
    if (JSON.stringify(values) !== JSON.stringify(['first', 'second']))
      throw new Error('Queue results changed under GJS');
    if (JSON.stringify(order) !== JSON.stringify(['first-start', 'first-end', 'second']))
      throw new Error(`Queued mutations ran out of order: ${order.join(',')}`);
    if (queue.hasPending('first') || queue.hasPending('second'))
      throw new Error('Settled mutations remained pending');
  } catch (error) {
    failure = error;
  } finally {
    if (timeoutActive) {
      GLib.Source.remove(timeoutId);
      timeoutActive = false;
    }
    loop.quit();
  }
}, error => {
  failure = error;
  if (timeoutActive) {
    GLib.Source.remove(timeoutId);
    timeoutActive = false;
  }
  loop.quit();
});

const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
  timeoutActive = false;
  failure ??= new Error('GJS mutation queue test timed out');
  loop.quit();
  return GLib.SOURCE_REMOVE;
});

loop.run();
if (failure)
  throw failure;
