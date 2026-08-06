desktop_file = configure_file(
  input: app_id + '.desktop.in',
  output: app_id + '.desktop',
  configuration: {'APP_ID': app_id}
)
install_data(desktop_file, install_dir: join_paths(get_option('datadir'), 'applications'))
install_data(app_id + '.metainfo.xml', install_dir: join_paths(get_option('datadir'), 'metainfo'))
install_data(
  'icons/hicolor/scalable/apps/' + app_id + '.svg',
  install_dir: join_paths(get_option('datadir'), 'icons', 'hicolor', 'scalable', 'apps')
)

fluent_dashboard_icons = files(
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-accounting.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-apps.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-backup.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-board.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-calendar.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-credentials.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-document.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-folder.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-guide.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-mail.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-people.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-report.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-scan.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-support.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-video.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-color-web.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-accounting.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-apps.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-backup.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-board.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-calendar.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-credentials.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-document.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-folder.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-guide.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-mail.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-people.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-report.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-scan.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-support.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-video.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-linux-grey-web.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-accounting.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-apps.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-backup.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-board.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-calendar.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-credentials.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-document.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-folder.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-guide.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-mail.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-people.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-report.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-scan.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-support.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-video.svg',
  'icons/hicolor/scalable/actions/workspace-hub-fluent-ui-color-web.svg',
)
install_data(fluent_dashboard_icons, install_dir: join_paths(get_option('datadir'), 'icons', 'hicolor', 'scalable', 'actions'))

install_data(
  files('licenses/fluent-ui-system-icons-LICENSE.txt', 'licenses/fluent-icon-theme-COPYING.txt'),
  install_dir: join_paths(get_option('datadir'), 'doc', 'workspace-hub', 'licenses')
)

install_data(
  '../THIRD-PARTY-NOTICES.md',
  install_dir: join_paths(get_option('datadir'), 'doc', 'workspace-hub')
)
