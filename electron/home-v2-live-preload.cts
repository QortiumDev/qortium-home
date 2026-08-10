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

contextBridge.exposeInMainWorld('homeV2Apps', {
  destroy: (request: unknown) => ipcRenderer.invoke('qdn-views:destroy', request),
  hide: (request: unknown) => ipcRenderer.invoke('qdn-views:hide', request),
  navigate: (request: unknown) => ipcRenderer.invoke('qdn-views:navigate', request),
  reload: (request: unknown) => ipcRenderer.invoke('qdn-views:reload', request),
  show: (request: unknown) => ipcRenderer.invoke('qdn-views:show', request),
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
