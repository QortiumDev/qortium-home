const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('qortiumHome', {
  appName: 'Qortium Home',
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    getCapabilities: () => Promise.resolve({
      canCreateWallet: true,
      canExportWalletFile: false,
      canLoadWalletFile: true,
    }),
    getProfile: (accountId: string) => ipcRenderer.invoke('accounts:getProfile', accountId),
    selectWalletFile: () => ipcRenderer.invoke('accounts:selectWalletFile'),
    discardLoadedWallet: (token: string) => ipcRenderer.invoke('accounts:discardLoadedWallet', token),
    saveLoadedWallet: (token: string, name: string) =>
      ipcRenderer.invoke('accounts:saveLoadedWallet', token, name),
    createWallet: (name: string, password: string) =>
      ipcRenderer.invoke('accounts:createWallet', name, password),
    exportWallet: () => Promise.reject(new Error('Wallet export is only available in the Android app right now.')),
    setActiveAccount: (accountId: string) =>
      ipcRenderer.invoke('accounts:setActiveAccount', accountId),
    unlockWallet: (accountId: string, password: string) =>
      ipcRenderer.invoke('accounts:unlockWallet', accountId, password),
    lockWallet: (accountId: string) => ipcRenderer.invoke('accounts:lockWallet', accountId),
    removeWallet: (accountId: string, password?: string) =>
      ipcRenderer.invoke('accounts:removeWallet', accountId, password),
  },
  core: {
    checkReleases: () => ipcRenderer.invoke('core:checkReleases'),
    getStatus: () => ipcRenderer.invoke('core:getStatus'),
    install: (request: { channel?: 'prerelease' | 'stable' }) =>
      ipcRenderer.invoke('core:install', request),
    installJava: () => ipcRenderer.invoke('core:installJava'),
    start: () => ipcRenderer.invoke('core:start'),
    stop: () => ipcRenderer.invoke('core:stop'),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => {
        callback(progress);
      };

      ipcRenderer.on('core:progress', listener);

      return () => {
        ipcRenderer.removeListener('core:progress', listener);
      };
    },
  },
  updates: {
    downloadAsset: (request: {
      asset: { digest: string | null; downloadUrl: string; name: string; size: number };
      platform: { arch: string; label: string; os: string; supported: boolean };
      releaseTag: string;
    }) => ipcRenderer.invoke('updates:downloadAsset', request),
    getEnvironment: () => ipcRenderer.invoke('updates:getEnvironment'),
    openDownloadedFile: (filePath: string) => ipcRenderer.invoke('updates:openDownloadedFile', filePath),
    openReleasePage: (url: string) => ipcRenderer.invoke('updates:openReleasePage', url),
    showDownloadedFile: (filePath: string) => ipcRenderer.invoke('updates:showDownloadedFile', filePath),
  },
  system: {
    openPath: (filePath: string) => ipcRenderer.invoke('system:openPath', filePath),
  },
  windows: {
    closeCurrentWindow: () => ipcRenderer.invoke('windows:closeCurrentWindow'),
    getStartupPayload: () => ipcRenderer.invoke('windows:getStartupPayload'),
    openDashboardWindow: () => ipcRenderer.invoke('windows:openDashboardWindow'),
    openTabInNewWindow: (request: { tab: unknown }) =>
      ipcRenderer.invoke('windows:openTabInNewWindow', request),
  },
  menu: {
    onCommand: (callback: (command: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: unknown) => {
        callback(command);
      };

      ipcRenderer.on('menu:command', listener);

      return () => {
        ipcRenderer.removeListener('menu:command', listener);
      };
    },
  },
  node: {
    checkCoreUpdate: () => ipcRenderer.invoke('node:checkCoreUpdate'),
    getSettings: () => ipcRenderer.invoke('node:getSettings'),
    installCoreUpdate: () => ipcRenderer.invoke('node:installCoreUpdate'),
    saveSettings: (request: { apiKey?: string; customUrl?: string; mode: 'custom' | 'local' | 'network' }) =>
      ipcRenderer.invoke('node:saveSettings', request),
    testConnection: (request: { apiKey?: string; customUrl?: string; mode: 'custom' | 'local' | 'network' }) =>
      ipcRenderer.invoke('node:testConnection', request),
    getStatus: () => ipcRenderer.invoke('node:getStatus'),
  },
  qdn: {
    authorizeResource: (request: { identifier?: string; name: string; service: string }) =>
      ipcRenderer.invoke('qdn:authorizeResource', request),
    listResources: (request: {
      exactMatchNames?: boolean;
      includeMetadata?: boolean;
      includeStatus?: boolean;
      limit?: number;
      name?: string;
      service?: string;
    }) => ipcRenderer.invoke('qdn:listResources', request),
    fetchNodeApi: (request: { maxBytes?: number; method?: 'GET' | 'HEAD'; path: string }) =>
      ipcRenderer.invoke('qdn:fetchNodeApi', request),
    fetchResourceText: (request: {
      identifier?: string;
      maxBytes?: number;
      name: string;
      path?: string;
      service: string;
    }) => ipcRenderer.invoke('qdn:fetchResourceText', request),
    prepareArchiveRender: (request: {
      identifier?: string;
      name: string;
      path?: string;
      service: string;
    }) => ipcRenderer.invoke('qdn:prepareArchiveRender', request),
    downloadResource: (request: {
      identifier?: string;
      name: string;
      path?: string;
      service: string;
      suggestedFilename?: string;
    }) => ipcRenderer.invoke('qdn:downloadResource', request),
  },
  qdnViews: {
    show: (request: {
      accountId: string | null;
      bounds: { height: number; width: number; x: number; y: number };
      nodeApiUrl: string;
      renderUrl: string;
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:show', request),
    setBounds: (request: {
      bounds: { height: number; width: number; x: number; y: number };
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:setBounds', request),
    hide: (tabId: string) => ipcRenderer.invoke('qdn-views:hide', { tabId }),
    destroy: (tabId: string) => ipcRenderer.invoke('qdn-views:destroy', { tabId }),
  },
  qdnPermissions: {
    onAccountReadRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:account-read-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:account-read-request', listener);
      };
    },
    resolveAccountReadRequest: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('qdn-app:resolveAccountReadApproval', { approved, requestId }),
    onWriteRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:write-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:write-request', listener);
      };
    },
    resolveWriteRequest: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('qdn-app:resolveWriteApproval', { approved, requestId }),
  },
});
