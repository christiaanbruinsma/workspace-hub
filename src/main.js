import GLib from 'gi://GLib';
import {WorkspaceHubApplication} from './application.js';

const app = new WorkspaceHubApplication();
const exitCode = await app.runAsync([GLib.get_prgname(), ...ARGV]);

export default exitCode;
