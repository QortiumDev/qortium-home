const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('homeV2Nodes', {
  getSnapshot: () => ipcRenderer.invoke('home-v2-nodes:getSnapshot'),
  getShellState: () => ipcRenderer.invoke('home-v2-shell:getState'),
  saveShellState: (value: unknown) =>
    ipcRenderer.invoke('home-v2-shell:saveState', value),
  listAccounts: () => ipcRenderer.invoke('home-v2-accounts:list'),
  listAppResources: (network: 'qortal' | 'qortium', name: string) =>
    ipcRenderer.invoke('home-v2-nodes:listAppResources', network, name),
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
  setMode: (
    network: 'qortal' | 'qortium',
    mode: 'custom' | 'disabled' | 'local' | 'public',
  ) => ipcRenderer.invoke('home-v2-nodes:setMode', network, mode),
  setCustomUrl: (network: 'qortal' | 'qortium', customUrl: string) =>
    ipcRenderer.invoke('home-v2-nodes:setCustomUrl', network, customUrl),
})

contextBridge.exposeInMainWorld('homeV2CoreManagers', {
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
    action: 'initial-install' | 'install-java' | 'strict-update',
    release?: { channel: 'prerelease' | 'stable'; expectedTag: string },
  ) => ipcRenderer.invoke('home-v2-core-manager:runMaintenanceAction', {
    action,
    ...(release ?? {}),
    revision: 1,
    schema: 'home-v2-core-maintenance-mutation-request',
  }),
  getUpdatePolicy: () =>
    ipcRenderer.invoke('home-v2-core-manager:getUpdatePolicy', {
      revision: 1,
      schema: 'home-v2-core-update-policy-get-request',
    }),
  setUpdatePolicy: (
    expectedGeneration: number,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy',
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
  start: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-manager:start', { network }),
  stop: (network: 'qortal' | 'qortium') =>
    ipcRenderer.invoke('home-v2-core-manager:stop', { network }),
})

contextBridge.exposeInMainWorld('homeV2AppUpdates', {
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
  reveal: (downloadId: string) =>
    ipcRenderer.invoke('home-v2-app-update:reveal', {
      downloadId,
      revision: 1,
      schema: 'home-v2-app-update-reveal-request',
    }),
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
  show: (request: unknown) => ipcRenderer.invoke('qdn-views:show', request),
  openAsWidget: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:open', request),
  syncWidgets: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:sync-state', request),
  resolvePermission: (request: unknown) =>
    ipcRenderer.send('home-v2-app:permission-resolve', request),
  onOpenAddress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-address', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-address', handler)
  },
  onOpenResourceViewer: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-resource-viewer', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-resource-viewer', handler)
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
})
