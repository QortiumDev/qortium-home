const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

type HomeV2MenuCommand =
  | 'close-tab'
  | 'focus-address-bar'
  | 'go-back'
  | 'go-forward'
  | 'new-tab'
  | 'reload-tab'
  | 'reopen-closed-tab'
  | 'text-size-decrease'
  | 'text-size-increase'
  | 'text-size-reset'

const HOME_V2_MENU_COMMANDS = new Set<HomeV2MenuCommand>([
  'close-tab',
  'focus-address-bar',
  'go-back',
  'go-forward',
  'new-tab',
  'reload-tab',
  'reopen-closed-tab',
  'text-size-decrease',
  'text-size-increase',
  'text-size-reset',
])

function isHomeV2MenuCommand(value: unknown): value is HomeV2MenuCommand {
  return (
    typeof value === 'string' &&
    HOME_V2_MENU_COMMANDS.has(value as HomeV2MenuCommand)
  )
}

contextBridge.exposeInMainWorld('homeV2MenuCommands', {
  onCommand: (listener: (command: HomeV2MenuCommand) => void) => {
    const handler = (_event: unknown, value: unknown) => {
      if (isHomeV2MenuCommand(value)) listener(value)
    }
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.removeListener('menu:command', handler)
  },
})

contextBridge.exposeInMainWorld('homeV2Zoom', {
  step: (direction: 'in' | 'out') =>
    ipcRenderer.invoke('home-v2-zoom:step', direction),
  set: (percent: number) => ipcRenderer.invoke('home-v2-zoom:set', percent),
  // Keyboard/wheel zoom changes originate in main; the shell follows them so
  // the Appearance setting cannot drift away from the actual zoom.
  onChanged: (listener: (percent: number) => void) => {
    const handler = (_event: unknown, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) listener(value)
    }
    ipcRenderer.on('zoom:changed', handler)
    return () => ipcRenderer.removeListener('zoom:changed', handler)
  },
})

// Write-only, one short string at a time. The shell's session denies every
// permission request, so navigator.clipboard rejects there and its copy
// actions have to reach the system clipboard through main.
contextBridge.exposeInMainWorld('homeV2Clipboard', {
  copyText: (value: string): Promise<void> =>
    ipcRenderer.invoke('home-v2-shell:copy-text', value),
})

type HomeV2WindowBehavior = {
  closeToTray: boolean
  warnOnCloseWithMultipleTabs: boolean
}

// A tab in transit between two windows: addresses and one opaque account id,
// nothing else. Main rebuilds this from what the sending renderer supplied
// (sanitizeHomeV2TabTransfer) and the receiving renderer validates it again,
// so it is declared structurally here rather than trusted as a shape.
type HomeV2TabTransfer = {
  revision: number
  address: string
  accountId?: string
  title?: string
  history?: { entries: { address: string; title?: string }[]; index: number }
}

contextBridge.exposeInMainWorld('homeV2Windows', {
  // Null in the window Home started with; the transferred tab in a detached
  // one. Returned as unknown on purpose: the renderer re-validates it.
  getStartup: (): Promise<unknown> =>
    ipcRenderer.invoke('home-v2-windows:getStartup'),
  openTab: (transfer: HomeV2TabTransfer): Promise<void> =>
    ipcRenderer.invoke('home-v2-windows:openTab', transfer),
  /**
   * Offers a dragged tab to whichever other Home window is under the pointer.
   * Resolves false when there is none, so the caller opens a new window
   * instead — the previous behaviour, and why a miss cannot lose a tab.
   */
  adoptTabAt: (transfer: HomeV2TabTransfer, x: number, y: number): Promise<boolean> =>
    ipcRenderer.invoke('home-v2-windows:adoptTabAt', { transfer, x, y }),
  /** Fires in the RECEIVING window when a tab is dropped onto it. */
  onAdoptTab: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-windows:adopt-tab', handler)
    return () => ipcRenderer.removeListener('home-v2-windows:adopt-tab', handler)
  },
  // What closing the main window does. Main owns these two settings because it
  // is what has to act on them, at a moment when no renderer can be asked.
  getBehavior: (): Promise<HomeV2WindowBehavior> =>
    ipcRenderer.invoke('home-v2-windows:getBehavior'),
  // Takes one or both settings and returns the whole record as it now stands.
  setBehavior: (
    behavior: Partial<HomeV2WindowBehavior>,
  ): Promise<HomeV2WindowBehavior> =>
    ipcRenderer.invoke('home-v2-windows:setBehavior', behavior),
})

contextBridge.exposeInMainWorld('homeV2Nodes', {
  getSnapshot: () => ipcRenderer.invoke('home-v2-nodes:getSnapshot'),
  // Settings-only, so the Dashboard can paint the right networks immediately
  // instead of waiting out the snapshot's node probes.
  getModes: () => ipcRenderer.invoke('home-v2-nodes:getModes'),
  getShellState: () => ipcRenderer.invoke('home-v2-shell:getState'),
  saveShellState: (value: unknown) =>
    ipcRenderer.invoke('home-v2-shell:saveState', value),
  saveShellGlobalState: (value: unknown) =>
    ipcRenderer.invoke('home-v2-shell:saveGlobalState', value),
  listAccounts: () => ipcRenderer.invoke('home-v2-accounts:list'),
  listAppResources: (
    network: 'qortal' | 'qortium',
    name: string,
    // R4-4: the browser-archive service the address named. Optional on the
    // wire so the main-side handler keeps its historical APP default.
    service?: 'APP' | 'WEBSITE' | 'GAME',
  ) =>
    ipcRenderer.invoke('home-v2-nodes:listAppResources', network, name, service),
  readIdentity: (
    network: 'qortal' | 'qortium',
    request: {
      kind:
        | 'accountAvatarInfo'
        | 'legacyAvatarResource'
        | 'name'
        | 'namesByAddress'
        | 'primaryName'
      value: string
    },
  ) => ipcRenderer.invoke('home-v2-nodes:readIdentity', network, request),
  readAvatar: (
    network: 'qortal' | 'qortium',
    request: {
      address: string
      pointer: {
        identifier: string
        name: string
        service: string
        source: 'account-pointer' | 'legacy-name'
      }
    },
  ) => ipcRenderer.invoke('home-v2-nodes:readAvatar', network, request),
  readAppIcon: (
    network: 'qortal' | 'qortium',
    request: {
      identifier: string | null
      name: string
      service: 'APP' | 'WEBSITE' | 'GAME'
    },
  ) => ipcRenderer.invoke('home-v2-nodes:readAppIcon', network, request),
  setMode: (
    network: 'qortal' | 'qortium',
    mode: 'custom' | 'disabled' | 'local' | 'public',
  ) => ipcRenderer.invoke('home-v2-nodes:setMode', network, mode),
  setCustomUrl: (network: 'qortal' | 'qortium', customUrl: string) =>
    ipcRenderer.invoke('home-v2-nodes:setCustomUrl', network, customUrl),
  // Read-only: whether the selected Qortium node is one the user administers,
  // plus its origin and trust revision. Never the key.
  adminTrust: () => ipcRenderer.invoke('home-v2-nodes:adminTrust'),
})

// The node administration key travels on its own one-way channel, never
// through the node surface above: it goes to OS-protected main-process
// storage and is never read back. Only the attached/origin summary returns.
contextBridge.exposeInMainWorld('homeV2NodeAdmin', {
  attach: (network: 'qortium', key: string) =>
    ipcRenderer.invoke('home-v2-node-admin:attach', network, key),
  clear: (network: 'qortium') =>
    ipcRenderer.invoke('home-v2-node-admin:clear', network),
})

/**
 * Home's own read-only view of foreign transactions whose outcome could not
 * be proved. Shell-only: it is not a QDN action, no app can reach it, and
 * there is deliberately no companion that removes an entry.
 */
contextBridge.exposeInMainWorld('homeV2ForeignWallet', {
  listPendingTransactions: () =>
    ipcRenderer.invoke('home-v2-app:foreignWalletPendingTransactions'),
})

contextBridge.exposeInMainWorld('homeV2RetainedViewer', {
  openPublic: (request: { location: string; viewerId: string }) => ipcRenderer.invoke('home-v2-retained-viewer:openPublic', request),
  closePublic: (viewerId: string) => ipcRenderer.invoke('home-v2-retained-viewer:closePublic', viewerId),
  readBytes: (request: { maxBytes: number; url: string }) =>
    ipcRenderer.invoke('home-v2-retained-viewer:readBytes', request),
  save: (request: { filename: string; url: string }) =>
    ipcRenderer.invoke('home-v2-retained-viewer:save', request),
  saveBytes: (request: { bytes: Uint8Array; filename: string; mimeType: string }) =>
    ipcRenderer.invoke('home-v2-retained-viewer:saveBytes', request),
})

contextBridge.exposeInMainWorld('homeV2CoreDocs', {
  enable: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-docs:enable', network),
  probe: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-docs:probe', network),
})

contextBridge.exposeInMainWorld('homeV2CoreManagers', {
  // Home 2's ONLY push channel for Core work. Everything else on this surface
  // is invoke-only by design; install progress is the exception because a
  // percentage that arrives 30 seconds late is not progress. It carries no
  // authority — it cannot start, stop or install anything, only report.
  onMaintenanceProgress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-core-manager:progress', handler)
    return () => ipcRenderer.removeListener('home-v2-core-manager:progress', handler)
  },
  // The I2P router's install progress, same shape and same reasoning as the
  // Core's. Report-only: it cannot start, stop or install anything.
  onTransportProgress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-transport:progress', handler)
    return () => ipcRenderer.removeListener('home-v2-transport:progress', handler)
  },
  listQortalAdoptionCandidates: () =>
    ipcRenderer.invoke('home-v2-qortal-adoption:list', {
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-list-request',
    }),
  browseQortalAdoptionDirectory: () =>
    ipcRenderer.invoke('home-v2-qortal-adoption:browse', {
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-browse-request',
    }),
  selectQortalAdoptionCandidate: (candidateId: string) =>
    ipcRenderer.invoke('home-v2-qortal-adoption:select', {
      candidateId,
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-adoption-selection-request',
    }),
  getQortalMaintenanceStatus: () =>
    ipcRenderer.invoke('home-v2-qortal-maintenance:getStatus', {
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-request',
    }),
  checkQortalMaintenanceRelease: () =>
    ipcRenderer.invoke('home-v2-qortal-maintenance:checkRelease', {
      network: 'qortal',
      revision: 1,
      schema: 'home-v2-qortal-maintenance-release-request',
    }),
  runQortalMaintenanceAction: (
    action: 'initial-install' | 'strict-update',
    expectedTag: string,
  ) => ipcRenderer.invoke('home-v2-qortal-maintenance:runAction', {
    action,
    expectedTag,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-mutation-request',
  }),
  getMaintenanceStatus: () =>
    ipcRenderer.invoke('home-v2-core-manager:getMaintenanceStatus', {
      revision: 1,
      schema: 'home-v2-core-maintenance-request',
    }),
  checkMaintenanceRelease: () =>
    ipcRenderer.invoke('home-v2-core-manager:checkMaintenanceRelease', {
      revision: 1,
      schema: 'home-v2-core-maintenance-release-request',
    }),
  runMaintenanceAction: (
    action: 'downgrade' | 'initial-install' | 'install-java' | 'strict-update',
    release?: { channel: 'prerelease' | 'stable'; confirmDowngrade?: boolean; expectedTag: string },
  ) => ipcRenderer.invoke('home-v2-core-manager:runMaintenanceAction', {
    action,
    ...(release ?? {}),
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  }),
  getTransportMaintenanceStatus: () =>
    ipcRenderer.invoke('home-v2-core-manager:getTransportMaintenanceStatus', {
      network: 'qortium',
      revision: 1,
      schema: 'home-v2-transport-maintenance-request',
    }),
  runTransportMaintenanceAction: (
    action: 'ensure-router' | 'reveal-router' | 'set-mode' | 'set-mode-live' |
      'stop-router' | 'update-router',
    transportMode: 'direct-and-i2p' | 'direct-only' | 'i2p-only' | null,
  ) => ipcRenderer.invoke('home-v2-core-manager:runTransportMaintenanceAction', {
    action,
    network: 'qortium',
    revision: 1,
    schema: 'home-v2-transport-maintenance-mutation-request',
    transportMode,
  }),
  getUpdatePolicy: () =>
    ipcRenderer.invoke('home-v2-core-manager:getUpdatePolicy', {
      revision: 1,
      schema: 'home-v2-core-update-policy-get-request',
    }),
  setUpdatePolicy: (
    expectedGeneration: number,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy',
    value: 'install' | 'notify' | 'off',
  ) => ipcRenderer.invoke('home-v2-core-manager:setUpdatePolicy', {
    expectedGeneration,
    field,
    revision: 1,
    schema: 'home-v2-core-update-policy-set-request',
    value,
  }),
  getStatus: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-manager:getStatus', { network }),
  revealInstall: () => ipcRenderer.invoke('home-v2-core-manager:revealInstall'),

  start: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-manager:start', { network }),
  stop: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-manager:stop', { network }),
})

contextBridge.exposeInMainWorld('homeV2AppUpdates', {
  // Push, like the Core progress channel and for the same reason: a download
  // percentage that arrives after the download is not progress. Report-only.
  onDownloadProgress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app-update:progress', handler)
    return () => ipcRenderer.removeListener('home-v2-app-update:progress', handler)
  },
  claimAutomatic: () =>
    ipcRenderer.invoke('home-v2-app-update:claim-automatic', {
      revision: 1,
      schema: 'home-v2-app-update-automatic-claim-request',
    }),
  getSettings: () =>
    ipcRenderer.invoke('home-v2-app-update:get-settings', {
      revision: 1,
      schema: 'home-v2-app-update-settings-get-request',
    }),
  check: (
    channel: 'prerelease' | 'stable',
    settingsGeneration: number | null = null,
  ) =>
    ipcRenderer.invoke('home-v2-app-update:check', {
      channel,
      revision: 1,
      schema: 'home-v2-app-update-check-request',
      settingsGeneration,
    }),
  download: (
    channel: 'prerelease' | 'stable',
    releaseTag: string,
    settingsGeneration: number | null = null,
  ) =>
    ipcRenderer.invoke('home-v2-app-update:download', {
      channel,
      releaseTag,
      revision: 1,
      schema: 'home-v2-app-update-download-request',
      settingsGeneration,
    }),
  open: (downloadId: string) =>
    ipcRenderer.invoke('home-v2-app-update:open', {
      downloadId,
      revision: 1,
      schema: 'home-v2-app-update-open-request',
    }),
  reveal: (downloadId: string) =>
    ipcRenderer.invoke('home-v2-app-update:reveal', {
      downloadId,
      revision: 1,
      schema: 'home-v2-app-update-reveal-request',
    }),
  // Home's OWN install folder. Takes no argument and returns only whether a
  // window opened: the path never crosses this boundary.
  revealInstallFolder: (): Promise<boolean> =>
    ipcRenderer.invoke('home-v2-app-update:reveal-install-folder'),
  openReleasePage: (channel: 'prerelease' | 'stable', releaseTag: string) =>
    ipcRenderer.invoke('home-v2-app-update:open-release-page', {
      channel,
      releaseTag,
      revision: 1,
      schema: 'home-v2-app-update-open-release-request',
    }),
  setSettings: (
    expectedGeneration: number,
    settings: {
      homeUpdatePolicy: 'auto-download' | 'notify' | 'off'
      releaseChannel: 'prerelease' | 'stable'
    },
  ) => ipcRenderer.invoke('home-v2-app-update:set-settings', {
    expectedGeneration,
    revision: 1,
    schema: 'home-v2-app-update-settings-set-request',
    settings,
  }),
})

contextBridge.exposeInMainWorld('homeV2ReleaseNotes', {
  load: (product: 'core' | 'home', tagName: string | null) =>
    ipcRenderer.invoke('home-v2-release-notes:load', {
      product,
      revision: 1,
      schema: 'home-v2-release-notes-load-request',
      tagName,
    }),
  openLink: (documentId: string, url: string) =>
    ipcRenderer.invoke('home-v2-release-notes:open-link', {
      documentId,
      revision: 1,
      schema: 'home-v2-release-notes-open-link-request',
      url,
    }),
})

contextBridge.exposeInMainWorld('homeV2QdnSettings', {
  get: () => ipcRenderer.invoke('home-v2-qdn-settings:get', {
    revision: 1,
    schema: 'home-v2-qdn-settings-get-request',
  }),
  setAssignment: (request: {
    expectedAssignmentRevision: number
    role: string
    url: string
  }) => ipcRenderer.invoke('home-v2-qdn-settings:set-assignment', {
    expectedAssignmentRevision: request.expectedAssignmentRevision,
    revision: 1,
    role: request.role,
    schema: 'home-v2-qdn-settings-set-assignment-request',
    url: request.url,
  }),
  setMuted: (request: {
    appKey: string
    expectedNotificationRevision: number
    muted: boolean
  }) => ipcRenderer.invoke('home-v2-qdn-settings:set-muted', {
    appKey: request.appKey,
    expectedNotificationRevision: request.expectedNotificationRevision,
    muted: request.muted,
    revision: 1,
    schema: 'home-v2-qdn-settings-set-muted-request',
  }),
  revoke: (request: {
    appKey: string
    expectedNotificationRevision: number
  }) => ipcRenderer.invoke('home-v2-qdn-settings:revoke', {
    appKey: request.appKey,
    expectedNotificationRevision: request.expectedNotificationRevision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-request',
  }),
  revokeBookmarks: (request: {
    // Present only for account-scoped capabilities; the main-process parser
    // requires it for those and rejects it for the others.
    accountId?: string
    appKey: string
    capability?: 'account.read' | 'bookmarks.manage' | 'chat.send' | 'notifications.manage'
    expectedAssignmentRevision: number
  }) => ipcRenderer.invoke('home-v2-qdn-settings:revoke-bookmarks', {
    ...(typeof request.accountId === 'string' ? { accountId: request.accountId } : {}),
    appKey: request.appKey,
    capability: request.capability ?? 'bookmarks.manage',
    expectedAssignmentRevision: request.expectedAssignmentRevision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  }),
  subscribe: (listener: () => void) => {
    const wrapped = () => listener()
    ipcRenderer.on('home-v2-qdn-settings:changed', wrapped)
    return () => ipcRenderer.removeListener('home-v2-qdn-settings:changed', wrapped)
  },
})

contextBridge.exposeInMainWorld('homeV2NotificationPolicy', {
  get: () => ipcRenderer.invoke('home-v2-notification-policy:get'),
  set: (request: { enabled: boolean; expectedGeneration: number }) =>
    ipcRenderer.invoke('home-v2-notification-policy:set', request),
  subscribe: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: unknown, snapshot: unknown) => listener(snapshot)
    ipcRenderer.on('home-v2-notification-policy:changed', wrapped)
    return () => ipcRenderer.removeListener('home-v2-notification-policy:changed', wrapped)
  },
})

contextBridge.exposeInMainWorld('homeV2Collections', {
  readLegacy: () => ipcRenderer.invoke('home-v2-collections:read-legacy'),
  resolveRequest: (response: {
    error?: { code?: string; message: string }
    requestId: string
    result?: unknown
  }) => ipcRenderer.invoke('qdn-app:resolveBookmarkManagerRequest', {
    requestId: response.requestId,
    result: response.result,
    ...(response.error ? { code: response.error.code, error: response.error.message } : {}),
  }),
  onRequest: (listener: (request: unknown) => void) => {
    const wrapped = (_event: unknown, request: unknown) => listener(request)
    ipcRenderer.on('qdn-app:bookmark-manager-request', wrapped)
    return () => ipcRenderer.removeListener('qdn-app:bookmark-manager-request', wrapped)
  },
  onOpen: (listener: (request: unknown) => void) => {
    const wrapped = (_event: unknown, request: unknown) => listener(request)
    ipcRenderer.on('qdn-app:bookmarks-open', wrapped)
    return () => ipcRenderer.removeListener('qdn-app:bookmarks-open', wrapped)
  },
})

// The Home-settings round-trip. Structural twin of homeV2Collections above,
// because it is the same pattern: the main process holds the app request but
// the SHELL owns the data, so main asks and the shell answers.
//
// Nothing here reads or writes a setting. It carries an opaque envelope in each
// direction, and both ends validate it against
// electron/home-v2-home-settings-contract.ts.
contextBridge.exposeInMainWorld('homeV2HomeSettings', {
  onRequest: (listener: (request: unknown) => void) => {
    const wrapped = (_event: unknown, request: unknown) => listener(request)
    ipcRenderer.on('home-v2-app:home-settings-request', wrapped)
    return () => ipcRenderer.removeListener('home-v2-app:home-settings-request', wrapped)
  },
  resolveRequest: (response: {
    error?: { code?: string; message: string }
    requestId: string
    settings?: unknown
  }) => ipcRenderer.invoke('home-v2-app:resolveHomeSettingsRequest', {
    requestId: response.requestId,
    settings: response.settings,
    ...(response.error ? { code: response.error.code, error: response.error.message } : {}),
  }),
})

contextBridge.exposeInMainWorld('homeV2Vault', {
  addAddress: (accountId: string) => ipcRenderer.invoke('home-v2-vault:addAddress', accountId),
  create: (request: unknown) => ipcRenderer.invoke('home-v2-vault:create', request),
  discardLoadedWallet: (token: string) =>
    ipcRenderer.invoke('home-v2-vault:discardLoadedWallet', token),
  exportAccount: (accountId: string) => ipcRenderer.invoke('home-v2-vault:export', accountId),
  getPrivateKeyAddress: (privateKey: string) =>
    ipcRenderer.invoke('home-v2-vault:getPrivateKeyAddress', privateKey),
  getState: () => ipcRenderer.invoke('home-v2-vault:getState'),
  importPrivateKey: (request: unknown) =>
    ipcRenderer.invoke('home-v2-vault:importPrivateKey', request),
  lock: (accountId: string) => ipcRenderer.invoke('home-v2-vault:lock', accountId),
  removeAccount: (request: unknown) =>
    ipcRenderer.invoke('home-v2-vault:removeAccount', request),
  removeAddress: (addressId: string) =>
    ipcRenderer.invoke('home-v2-vault:removeAddress', addressId),
  rename: (request: unknown) => ipcRenderer.invoke('home-v2-vault:rename', request),
  requestRestore: () => ipcRenderer.invoke('home-v2-vault:requestRestore'),
  saveLoadedWallet: (request: unknown) =>
    ipcRenderer.invoke('home-v2-vault:saveLoadedWallet', request),
  select: (request: unknown) => ipcRenderer.invoke('home-v2-vault:select', request),
  selectWalletFile: () => ipcRenderer.invoke('home-v2-vault:selectWalletFile'),
  unlock: (request: unknown) => ipcRenderer.invoke('home-v2-vault:unlock', request),
  updateSecurity: (request: unknown) =>
    ipcRenderer.invoke('home-v2-vault:updateSecurity', request),
})

contextBridge.exposeInMainWorld('homeV2Apps', {
  accountLocked: () => ipcRenderer.send('home-v2-app:account-locked'),
  invalidateRuntime: (request: unknown) =>
    ipcRenderer.send('home-v2-app:invalidate-runtime', request),
  capture: (request: unknown) => ipcRenderer.invoke('qdn-views:capture', request),
  destroy: (request: unknown) => ipcRenderer.invoke('qdn-views:destroy', request),
  hide: (request: unknown) => ipcRenderer.invoke('qdn-views:hide', request),
  navigate: (request: unknown) => ipcRenderer.invoke('qdn-views:navigate', request),
  reload: (request: unknown) => ipcRenderer.invoke('qdn-views:reload', request),
  updateAccountState: (request: unknown) =>
    ipcRenderer.invoke('qdn-views:updateAccountState', request),
  updateBridgeStates: (request: unknown) =>
    ipcRenderer.invoke('qdn-views:updateBridgeStates', request),
  // Home-profile manager revisions (bookmarks, notifications). The delivery
  // machinery in qdn-views.ts already existed but was reachable only from Home
  // 1.x's preload; without this the v2 shell could change an app's notification
  // rules and an open app view would never hear about it. The main-process
  // handler re-validates the payload (validateQdnManagerRevisions) and ignores
  // a tabId this window does not own.
  updateManagerRevisions: (request: unknown) =>
    ipcRenderer.invoke('qdn-views:updateManagerRevisions', request),
  // Live Home-settings delivery to open app views. Same story as
  // updateManagerRevisions above: the qdn-views handler
  // ('qdn-views:broadcastHomeSettingsChanged', qdn-views.ts) has always existed
  // and Home 1.x's preload exposed it (electron/preload.cts), but Home 2's did
  // not — so an app listening for `qortium:home-settings-changed` (which the
  // shipped Notify app does) never heard a thing on Home 2, whether the change
  // came from Home's own Appearance panel or from UPDATE_HOME_SETTINGS. The
  // main-process handler re-validates the detail (sanitizeHomeSettingsBroadcastRequest)
  // and only touches views belonging to the calling window.
  broadcastHomeSettingsChanged: (detail: unknown) =>
    ipcRenderer.invoke('qdn-views:broadcastHomeSettingsChanged', { detail }),
  show: (request: unknown) => ipcRenderer.invoke('qdn-views:show', request),
  openAsWidget: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:open', request),
  // Availability only. The shell renderer's session blocks every network
  // request, so whether the tab's app publishes a widget face has to be
  // answered by main before the toolbar offers the control.
  probeWidget: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:probe', request),
  syncWidgets: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:sync-state', request),
  resolvePermission: (request: unknown) =>
    ipcRenderer.send('home-v2-app:permission-resolve', request),
  onOpenAddress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-address', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-address', handler)
  },
  onOpenAddressInTab: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-address-in-tab', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-address-in-tab', handler)
  },
  onOpenResourceViewer: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-resource-viewer', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-resource-viewer', handler)
  },
  // A publish preview opens as an app TAB, not the resource viewer: the thing
  // being previewed is usually a website, which the viewer cannot render.
  onOpenPublishPreview: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-publish-preview', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-publish-preview', handler)
  },
  onNotificationClicked: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:notification-clicked', handler)
    return () => ipcRenderer.removeListener('home-v2-app:notification-clicked', handler)
  },
  onPermissionRequest: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:permission-request', handler)
    return () => ipcRenderer.removeListener('home-v2-app:permission-request', handler)
  },
  onPermissionTimeout: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:permission-timeout', handler)
    return () => ipcRenderer.removeListener('home-v2-app:permission-timeout', handler)
  },
  onNavigationChanged: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('qdn-views:app-navigation-changed', handler)
    return () => ipcRenderer.removeListener('qdn-views:app-navigation-changed', handler)
  },
  // Whether the app in a tab has taken the whole window with HTML fullscreen.
  // The shell needs this to draw its own cue: a fullscreen app view paints over
  // every piece of Home chrome, so nothing on screen would otherwise tell the
  // user that what they are looking at is an untrusted app rather than Home.
  onFullscreenChanged: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('qdn-views:app-fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('qdn-views:app-fullscreen-changed', handler)
  },
})
