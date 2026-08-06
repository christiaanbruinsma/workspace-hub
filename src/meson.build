conf = configuration_data()
conf.set_quoted('APP_ID', app_id)
conf.set_quoted('VERSION', meson.project_version())
conf.set_quoted('PKGDATADIR', join_paths(get_option('prefix'), get_option('datadir'), meson.project_name()))
configure_file(input: 'config.js.in', output: 'config.js', configuration: conf)

install_data(
  files('main.js', 'application.js', 'window.js', 'style.css'),
  install_dir: join_paths(get_option('datadir'), meson.project_name())
)
install_data(
  files('services/default-profile.js', 'services/example-workspace.js', 'services/workspace-reset.js', 'services/workspace-contents-copy.js', 'services/profile-contract.js', 'services/workspace-library-contract.js', 'services/profile-store.js', 'services/workspace-items.js', 'services/workspace-item-transfer.js', 'services/library-transaction.js', 'services/library-mutation-queue.js', 'services/workspace-activation-coordinator.js', 'services/profile-three-way-merge.js', 'services/section-tabs.js', 'services/availability-service.js', 'services/diagnostic-contract.js', 'services/icon-provider.js', 'services/governance-contract.js', 'services/health-store.js', 'services/i18n.js', 'services/readiness-contract.js', 'services/application-catalog.js', 'services/flatpak-contract.js'),
  install_dir: join_paths(get_option('datadir'), meson.project_name(), 'services')
)
install_data(
  files('ui/item-actions-menu.js', 'ui/move-item-to-tab-dialog.js', 'ui/transfer-item-dialog.js', 'ui/copy-workspace-contents-dialog.js', 'ui/section-controller-contract.js', 'ui/transfer-view-reconciliation.js', 'ui/tile-editor-validation.js'),
  install_dir: join_paths(get_option('datadir'), meson.project_name(), 'ui')
)
install_data(
  meson.current_build_dir() / 'config.js',
  install_dir: join_paths(get_option('datadir'), meson.project_name())
)

launcher = configure_file(
  input: 'workspace-hub.in',
  output: meson.project_name(),
  configuration: {
    'GJS': find_program('gjs').full_path(),
    'PKGDATADIR': join_paths(get_option('prefix'), get_option('datadir'), meson.project_name())
  }
)
install_data(launcher, install_dir: get_option('bindir'), install_mode: 'rwxr-xr-x')
