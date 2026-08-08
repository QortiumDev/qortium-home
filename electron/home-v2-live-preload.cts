const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('homeV2Nodes', {
  getSnapshot: () => ipcRenderer.invoke('home-v2-nodes:getSnapshot'),
  setMode: (
    network: 'qortal' | 'qortium',
    mode: 'custom' | 'disabled' | 'local' | 'public',
  ) => ipcRenderer.invoke('home-v2-nodes:setMode', network, mode),
})
