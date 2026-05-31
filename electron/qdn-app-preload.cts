const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

type QdnAppRequest = Record<string, unknown>;

async function sendQdnAppRequest(request: QdnAppRequest) {
  return ipcRenderer.invoke('qdn-app:request', request);
}

contextBridge.exposeInMainWorld('qdnRequest', sendQdnAppRequest);
