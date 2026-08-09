const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('homeV2Nodes', {
  getSnapshot: () => ipcRenderer.invoke('home-v2-nodes:getSnapshot'),
  readIdentity: (
    network: 'qortal' | 'qortium',
    request: {
      kind: 'accountAvatarInfo' | 'name' | 'namesByAddress' | 'primaryName'
      value: string
    },
  ) => ipcRenderer.invoke('home-v2-nodes:readIdentity', network, request),
  setMode: (
    network: 'qortal' | 'qortium',
    mode: 'custom' | 'disabled' | 'local' | 'public',
  ) => ipcRenderer.invoke('home-v2-nodes:setMode', network, mode),
  setCustomUrl: (network: 'qortal' | 'qortium', customUrl: string) =>
    ipcRenderer.invoke('home-v2-nodes:setCustomUrl', network, customUrl),
})
