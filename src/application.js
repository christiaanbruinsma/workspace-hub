import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject';
import {APP_ID, VERSION, PKGDATADIR} from './config.js';
import {WorkspaceHubWindow} from './window.js';

export const WorkspaceHubApplication = GObject.registerClass(
class WorkspaceHubApplication extends Adw.Application {
  constructor() {
    super({application_id: APP_ID, flags: Gio.ApplicationFlags.DEFAULT_FLAGS});
    GLib.set_application_name('Workspace Hub');
  }

  vfunc_startup() {
    super.vfunc_startup();
    console.log(`[Workspace Hub][runtime] version=${VERSION}`);

    const provider = new Gtk.CssProvider();
    provider.load_from_path(GLib.build_filenamev([PKGDATADIR, 'style.css']));
    const display = Gdk.Display.get_default();
    if (display) {
      Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
      const iconTheme = Gtk.IconTheme.get_for_display(display);
      const home = GLib.get_home_dir();
      const iconPaths = [
        '/run/host/usr/share/icons',
        '/run/host/usr/share/pixmaps',
        '/var/lib/flatpak/exports/share/icons',
        '/var/lib/snapd/desktop/icons',
        GLib.build_filenamev([home, '.local', 'share', 'icons']),
        GLib.build_filenamev([home, '.local', 'share', 'flatpak', 'exports', 'share', 'icons']),
        GLib.build_filenamev([home, '.icons']),
      ];
      if (!GLib.getenv('FLATPAK_ID'))
        iconPaths.push('/usr/share/icons', '/usr/share/pixmaps');
      for (const path of iconPaths) {
        if (Gio.File.new_for_path(path).query_exists(null))
          iconTheme.add_search_path(path);
      }
    }

    const quit = new Gio.SimpleAction({name: 'quit'});
    quit.connect('activate', () => this.quit());
    this.add_action(quit);
    this.set_accels_for_action('app.quit', ['<primary>q']);

    const about = new Gio.SimpleAction({name: 'about'});
    about.connect('activate', () => {
      new Adw.AboutDialog({
        application_name: 'Workspace Hub',
        application_icon: APP_ID,
        developer_name: 'Christiaan Bruinsma',
        version: VERSION,
        comments: 'Your Linux workday, in one familiar place.',
        license_type: Gtk.License.GPL_3_0,
      }).present(this.active_window);
    });
    this.add_action(about);
  }

  vfunc_activate() {
    let window = this.active_window;
    if (!window)
      window = new WorkspaceHubWindow({application: this});
    window.present();
  }

});
