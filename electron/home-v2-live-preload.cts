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
      kind: 'accountAvatarInfo' | 'name' | 'namesByAddress' | 'primaryName'
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
  capture: (request: unknown) => ipcRenderer.invoke('qdn-views:capture', request),
  destroy: (request: unknown) => ipcRenderer.invoke('qdn-views:destroy', request),
  hide: (request: unknown) => ipcRenderer.invoke('qdn-views:hide', request),
  navigate: (request: unknown) => ipcRenderer.invoke('qdn-views:navigate', request),
  reload: (request: unknown) => ipcRenderer.invoke('qdn-views:reload', request),
  updateAccountState: (request: unknown) =>
    ipcRenderer.invoke('qdn-views:updateAccountState', request),
  show: (request: unknown) => ipcRenderer.invoke('qdn-views:show', request),
  openAsWidget: (request: unknown) => ipcRenderer.invoke('home-v2-widgets:open', request),
  resolvePermission: (request: unknown) =>
    ipcRenderer.send('home-v2-app:permission-resolve', request),
  onOpenAddress: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:open-address', handler)
    return () => ipcRenderer.removeListener('home-v2-app:open-address', handler)
  },
  onPermissionRequest: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('home-v2-app:permission-request', handler)
    return () => ipcRenderer.removeListener('home-v2-app:permission-request', handler)
  },
  onNavigationChanged: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('qdn-views:app-navigation-changed', handler)
    return () => ipcRenderer.removeListener('qdn-views:app-navigation-changed', handler)
  },
})
