node = find_program('node', required: false)
if node.found()
  test('profile contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'profile-contract.test.mjs')])
  test('public example neutrality', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'public-example-neutrality.test.mjs')])
  test('workspace library contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-library-contract.test.mjs')])
  test('workspace reset', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-reset.test.mjs')])
  test('example workspace', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'example-workspace.test.mjs')])
  test('workspace history restore', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-history-restore.test.mjs')])
  test('workspace restore ui contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-restore-ui-contract.test.mjs')])
  test('project source contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'project-source-contract.test.mjs')])
  test('application entrypoint contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'application-entrypoint.test.mjs')])
  test('workspace items', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-items.test.mjs')])
  test('section tabs', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'section-tabs.test.mjs')])
  test('diagnostic contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'diagnostic-contract.test.mjs')])
  test('icon provider', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'icon-provider.test.mjs')])
  test('governance contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'governance-contract.test.mjs')])
  test('health contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'health-contract.test.mjs')])
  test('i18n', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'i18n.test.mjs')])
  test('readiness contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'readiness-contract.test.mjs')])
  test('flatpak contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'flatpak-contract.test.mjs')])
  test('workspace item transfer', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-item-transfer.test.mjs')])
  test('workspace contents copy', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-contents-copy.test.mjs')])
  test('workspace contents copy ui contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-contents-copy-ui-contract.test.mjs')])
  test('library transaction', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'library-transaction.test.mjs')])
  test('library mutation queue', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'library-mutation-queue.test.mjs')])
  test('workspace activation coordinator', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'workspace-activation-coordinator.test.mjs')])
  test('profile three-way merge', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'profile-three-way-merge.test.mjs')])
  test('section controller contract', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'section-controller-contract.test.mjs')])
  test('save view state latest value', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'save-view-state-latest-value.test.mjs')])
  test('transfer view reconciliation', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'transfer-view-reconciliation.test.mjs')])
  test('tile editor validation', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'tile-editor-validation.test.mjs')])
  test('persistence recovery safety', node,
    args: ['--test', join_paths(meson.current_source_dir(), 'persistence-recovery-safety.test.mjs')])
endif


gjs_test = find_program('gjs', required: false)
if gjs_test.found()
  test('library mutation queue gjs main loop', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'library-mutation-queue-gjs.test.js')],
    timeout: 10)
  test('application runAsync gjs main loop', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'application-run-async-gjs.test.js')],
    timeout: 10)
  test('tile editor validation gjs', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'tile-editor-validation-gjs.test.js')],
    timeout: 10)
  test('persistence recovery safety gjs', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'persistence-recovery-gjs.test.js')],
    timeout: 10)
  test('workspace restore gjs', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'workspace-restore-gjs.test.js')],
    timeout: 10)
  test('workspace contents copy gjs', gjs_test,
    args: [join_paths(meson.current_source_dir(), 'workspace-contents-copy-gjs.test.js')],
    timeout: 10)
endif
