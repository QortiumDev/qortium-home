const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('qortiumHome', {
  appName: 'Qortium Home',
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    getCapabilities: () => Promise.resolve({
      canCreateWallet: true,
      canExportWalletFile: true,
      canLoadWalletFile: true,
    }),
    getProfile: (accountId: string) => ipcRenderer.invoke('accounts:getProfile', accountId),
    selectWalletFile: () => ipcRenderer.invoke('accounts:selectWalletFile'),
    discardLoadedWallet: (token: string) => ipcRenderer.invoke('accounts:discardLoadedWallet', token),
    saveLoadedWallet: (token: string, name: string) =>
      ipcRenderer.invoke('accounts:saveLoadedWallet', token, name),
    createWallet: (name: string, password: string) =>
      ipcRenderer.invoke('accounts:createWallet', name, password),
    getAddressFromPrivateKey: (privateKey: string) =>
      ipcRenderer.invoke('accounts:getAddressFromPrivateKey', privateKey),
    importPrivateKeyWallet: (name: string, privateKey: string, password: string) =>
      ipcRenderer.invoke('accounts:importPrivateKeyWallet', name, privateKey, password),
    exportWallet: (accountId: string) => ipcRenderer.invoke('accounts:exportWallet', accountId),
    setActiveAccount: (accountId: string) =>
      ipcRenderer.invoke('accounts:setActiveAccount', accountId),
    addDerivedAddress: (accountId: string) =>
      ipcRenderer.invoke('accounts:addDerivedAddress', accountId),
    unlockWallet: (accountId: string, password: string) =>
      ipcRenderer.invoke('accounts:unlockWallet', accountId, password),
    lockWallet: (accountId: string) => ipcRenderer.invoke('accounts:lockWallet', accountId),
    removeWallet: (accountId: string, password?: string) =>
      ipcRenderer.invoke('accounts:removeWallet', accountId, password),
  },
  core: {
    checkReleases: () => ipcRenderer.invoke('core:checkReleases'),
    getStatus: () => ipcRenderer.invoke('core:getStatus'),
    install: (request: {
      allowDowngrade?: boolean;
      channel?: 'prerelease' | 'stable';
      downgradeToken?: string;
    }) =>
      ipcRenderer.invoke('core:install', request),
    installJava: () => ipcRenderer.invoke('core:installJava'),
    refreshHelpers: () => ipcRenderer.invoke('core:refreshHelpers'),
    setJavaAutoUpdate: (enabled: boolean) => ipcRenderer.invoke('core:setJavaAutoUpdate', enabled),
    setUpdatePolicy: (request: {
      coreUpdatePolicy?: 'install' | 'notify' | 'off';
      javaUpdatePolicy?: 'install' | 'notify' | 'off';
    }) => ipcRenderer.invoke('core:setUpdatePolicy', request),
    start: () => ipcRenderer.invoke('core:start'),
    stop: () => ipcRenderer.invoke('core:stop'),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => {
        callback(status);
      };

      ipcRenderer.on('core:status', listener);

      return () => {
        ipcRenderer.removeListener('core:status', listener);
      };
    },
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
  i2pd: {
    getStatus: () => ipcRenderer.invoke('i2pd:getStatus'),
    install: () => ipcRenderer.invoke('i2pd:install'),
    start: () => ipcRenderer.invoke('i2pd:start'),
    stop: () => ipcRenderer.invoke('i2pd:stop'),
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => {
        callback(progress);
      };

      ipcRenderer.on('i2pd:progress', listener);

      return () => {
        ipcRenderer.removeListener('i2pd:progress', listener);
      };
    },
  },
  updates: {
    downloadAsset: (request: {
      asset: { digest: string | null; downloadUrl: string; name: string; size: number };
      platform: { arch: string; label: string; os: string; supported: boolean };
      releaseTag: string;
    }) => ipcRenderer.invoke('updates:downloadAsset', request),
    downloadReleaseAsset: (request: {
      asset: { digest: string | null; downloadUrl: string; name: string; size: number };
      platform: { arch: string; label: string; os: string; supported: boolean };
      releaseTag: string;
    }) => ipcRenderer.invoke('updates:downloadReleaseAsset', request),
    getEnvironment: () => ipcRenderer.invoke('updates:getEnvironment'),
    onDownloadProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => {
        callback(progress);
      };

      ipcRenderer.on('updates:downloadProgress', listener);

      return () => {
        ipcRenderer.removeListener('updates:downloadProgress', listener);
      };
    },
    openDownloadedFile: (filePath: string) => ipcRenderer.invoke('updates:openDownloadedFile', filePath),
    openReleasePage: (url: string) => ipcRenderer.invoke('updates:openReleasePage', url),
    showDownloadedFile: (filePath: string) => ipcRenderer.invoke('updates:showDownloadedFile', filePath),
  },
  system: {
    openPath: (filePath: string) => ipcRenderer.invoke('system:openPath', filePath),
    revealPath: (filePath: string) => ipcRenderer.invoke('system:revealPath', filePath),
    reportStartupPaint: (navToPaintMs: number) =>
      ipcRenderer.invoke('system:reportStartupPaint', navToPaintMs),
  },
  windows: {
    closeCurrentWindow: () => ipcRenderer.invoke('windows:closeCurrentWindow'),
    getStartupPayload: () => ipcRenderer.invoke('windows:getStartupPayload'),
    openDashboardWindow: () => ipcRenderer.invoke('windows:openDashboardWindow'),
    openTabInNewWindow: (request: { tab: unknown }) =>
      ipcRenderer.invoke('windows:openTabInNewWindow', request),
  },
  zoom: {
    get: () => ipcRenderer.invoke('zoom:get'),
    set: (percent: number) => ipcRenderer.invoke('zoom:set', percent),
    onChanged: (callback: (percent: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, percent: number) => {
        callback(percent);
      };

      ipcRenderer.on('zoom:changed', listener);

      return () => {
        ipcRenderer.removeListener('zoom:changed', listener);
      };
    },
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
    setLabels: (labels: Record<string, string>) => ipcRenderer.invoke('menu:setLabels', { labels }),
  },
  node: {
    checkCoreUpdate: () => ipcRenderer.invoke('node:checkCoreUpdate'),
    confirmCertificate: (nodeApiUrl: string, fingerprint: string) =>
      ipcRenderer.invoke('node:confirmCertificate', nodeApiUrl, fingerprint),
    enableApiDocumentation: () => ipcRenderer.invoke('node:enableApiDocumentation'),
    forgetCertificate: (nodeApiUrl: string) => ipcRenderer.invoke('node:forgetCertificate', nodeApiUrl),
    getCertificateStatus: (nodeApiUrl: string) =>
      ipcRenderer.invoke('node:getCertificateStatus', nodeApiUrl),
    hasStoredSettings: () => ipcRenderer.invoke('node:hasStoredSettings'),
    getSettings: () => ipcRenderer.invoke('node:getSettings'),
    getTransportStatus: () => ipcRenderer.invoke('node:getTransportStatus'),
    installCoreUpdate: () => ipcRenderer.invoke('node:installCoreUpdate'),
    saveSettings: (request: { apiKey?: string; customUrl?: string; mode: 'custom' | 'local' | 'network' }) =>
      ipcRenderer.invoke('node:saveSettings', request),
    setAllowedTransports: (transports: string[]) =>
      ipcRenderer.invoke('node:setAllowedTransports', transports),
    testConnection: (request: { apiKey?: string; customUrl?: string; mode: 'custom' | 'local' | 'network' }) =>
      ipcRenderer.invoke('node:testConnection', request),
    getStatus: () => ipcRenderer.invoke('node:getStatus'),
  },
  qdn: {
    hasNotificationStore: () => ipcRenderer.invoke('qdn:hasNotificationStore'),
    authorizeResource: (request: { identifier?: string; name: string; service: string }) =>
      ipcRenderer.invoke('qdn:authorizeResource', request),
    setAppNotificationsEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('qdn:setAppNotificationsEnabled', enabled),
    getNotificationStore: () => ipcRenderer.invoke('qdn:getNotificationStore'),
    onNotificationStoreChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('qdn:notification-store-changed', listener);
      return () => {
        ipcRenderer.removeListener('qdn:notification-store-changed', listener);
      };
    },
    setAppNotificationMuted: (appKey: string, muted: boolean) =>
      ipcRenderer.invoke('qdn:setAppNotificationMuted', appKey, muted),
    revokeAppNotifications: (appKey: string) =>
      ipcRenderer.invoke('qdn:revokeAppNotifications', appKey),
    getAppAssignmentsStore: () => ipcRenderer.invoke('qdn:getAppAssignmentsStore'),
    onAppAssignmentsChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('qdn:app-assignments-changed', listener);
      return () => {
        ipcRenderer.removeListener('qdn:app-assignments-changed', listener);
      };
    },
    setAppAssignment: (input: unknown) => ipcRenderer.invoke('qdn:setAppAssignment', input),
    migrateLegacyPreferredApps: (legacyPreferredApps: unknown) =>
      ipcRenderer.invoke('qdn:migrateLegacyPreferredApps', legacyPreferredApps),
    listResources: (request: {
      exactMatchNames?: boolean;
      includeMetadata?: boolean;
      includeStatus?: boolean;
      limit?: number;
      name?: string;
      prefix?: boolean;
      service?: string;
    }) => ipcRenderer.invoke('qdn:listResources', request),
    searchNames: (request: { limit?: number; prefix?: boolean; query: string }) =>
      ipcRenderer.invoke('qdn:searchNames', request),
    fetchNodeApi: (request: { maxBytes?: number; method?: 'GET' | 'HEAD'; path: string }) =>
      ipcRenderer.invoke('qdn:fetchNodeApi', request),
    fetchResourceText: (request: {
      identifier?: string;
      maxBytes?: number;
      name: string;
      path?: string;
      service: string;
    }) => ipcRenderer.invoke('qdn:fetchResourceText', request),
    fetchResourceData: (request: {
      allowMissing?: boolean;
      identifier?: string;
      maxBytes?: number;
      name: string;
      path?: string;
      service: string;
    }) => ipcRenderer.invoke('qdn:fetchResourceData', request),
    prepareArchiveRender: (request: {
      identifier?: string;
      name: string;
      path?: string;
      service: string;
    }) => ipcRenderer.invoke('qdn:prepareArchiveRender', request),
    previewContent: (request: { kind?: 'directory' | 'file'; path?: string; sourceToken?: string }) =>
      ipcRenderer.invoke('qdn:previewContent', request),
    downloadResource: (request: {
      identifier?: string;
      name: string;
      path?: string;
      service: string;
      suggestedFilename?: string;
    }) => ipcRenderer.invoke('qdn:downloadResource', request),
  },
  qdnViews: {
    broadcastHomeSettingsChanged: (detail: unknown) => ipcRenderer.invoke('qdn-views:broadcastHomeSettingsChanged', { detail }),
    show: (request: {
      accountId: string | null;
      bounds: { height: number; width: number; x: number; y: number };
      displaySettings: {
        language: 'ar' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hi' | 'hu' | 'it' | 'ja' | 'ko' | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
        accent: 'blue' | 'clay' | 'cyan' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow';
        textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
        theme: 'dark' | 'light';
        ui: 'classic' | 'modern' | 'fun';
      };
      managerRevisions?: {
        bookmarkManager: number;
        notificationManager: number;
      };
      nodeApiUrl: string;
      renderUrl: string;
      resourceUrl?: string;
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:show', request),
    setBounds: (request: {
      bounds: { height: number; width: number; x: number; y: number };
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:setBounds', request),
    navigate: (request: { index: number; tabId: string }) =>
      ipcRenderer.invoke('qdn-views:navigate', request),
    capture: (tabId: string) => ipcRenderer.invoke('qdn-views:capture', { tabId }),
    hide: (tabId: string) => ipcRenderer.invoke('qdn-views:hide', { tabId }),
    destroy: (tabId: string) => ipcRenderer.invoke('qdn-views:destroy', { tabId }),
    setAudioMuted: (request: { muted: boolean; tabId: string }) =>
      ipcRenderer.invoke('qdn-views:setAudioMuted', request),
    updateDisplaySettings: (request: {
      displaySettings: {
        language: 'ar' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hi' | 'hu' | 'it' | 'ja' | 'ko' | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
        accent: 'blue' | 'clay' | 'cyan' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow';
        textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
        theme: 'dark' | 'light';
        ui: 'classic' | 'modern' | 'fun';
      };
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:updateDisplaySettings', request),
    updateManagerRevisions: (request: {
      managerRevisions: {
        bookmarkManager: number;
        notificationManager: number;
      };
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:updateManagerRevisions', request),
    updateAccountState: (request: { accountId: string | null; isUnlocked: boolean; tabId: string }) =>
      ipcRenderer.invoke('qdn-views:updateAccountState', request),
    postMessage: (request: {
      message: {
        action: 'OPEN_APP_TARGET';
        requestedHandler: 'UI';
        query: { address?: string; group?: string };
      };
      tabId: string;
    }) => ipcRenderer.invoke('qdn-views:postMessage', request),
  },
  qdnPermissions: {
    onUnlockRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:unlock-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:unlock-request', listener);
      };
    },
    onWriteRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:write-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:write-request', listener);
      };
    },
    onHomeSettingsRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:home-settings-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:home-settings-request', listener);
      };
    },
    onBookmarkManagerRequest: (callback: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        callback(request);
      };

      ipcRenderer.on('qdn-app:bookmark-manager-request', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:bookmark-manager-request', listener);
      };
    },
    resolveUnlockRequest: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('qdn-app:resolveWriteApproval', { approved, requestId }),
    resolveWriteRequest: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('qdn-app:resolveWriteApproval', { approved, requestId }),
    resolveHomeSettingsRequest: (requestId: string, settings: unknown) =>
      ipcRenderer.invoke('qdn-app:resolveHomeSettingsRequest', { requestId, settings }),
    resolveBookmarkManagerRequest: (requestId: string, result: unknown, error?: { code?: string; message: string }) =>
      ipcRenderer.invoke('qdn-app:resolveBookmarkManagerRequest', {
        requestId,
        result,
        ...(error ? { code: error.code, error: error.message } : {}),
      }),
  },
  qdnEvents: {
    onOpenNewTab: (callback: (event: { address: string; sourceTabId: string | null }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { address: string; sourceTabId: string | null },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-new-tab', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-new-tab', listener);
      };
    },
    onOpenMediaPlayer: (
      callback: (event: {
        identifier: string | null;
        name: string;
        path: string | null;
        service: string;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { identifier: string | null; name: string; path: string | null; service: string },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-media-player', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-media-player', listener);
      };
    },
    onOpenDocumentViewer: (
      callback: (event: {
        identifier: string | null;
        name: string;
        path: string | null;
        service: string;
        filename: string | null;
        mimeType: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          identifier: string | null;
          name: string;
          path: string | null;
          service: string;
          filename: string | null;
          mimeType: string | null;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-document-viewer', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-document-viewer', listener);
      };
    },
    onOpenResourceViewer: (
      callback: (event: {
        identifier: string | null;
        name: string;
        path: string | null;
        service: string;
        filename: string | null;
        mimeType: string | null;
        sourceTabId: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          identifier: string | null;
          name: string;
          path: string | null;
          service: string;
          filename: string | null;
          mimeType: string | null;
          sourceTabId: string | null;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-resource-viewer', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-resource-viewer', listener);
      };
    },
    onOpenPublishSourcePreview: (
      callback: (event: {
        renderUrl: string;
        service: string;
        sourceKind: 'directory' | 'file';
        sourceName: string;
        sourceTabId: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          renderUrl: string;
          service: string;
          sourceKind: 'directory' | 'file';
          sourceName: string;
          sourceTabId: string | null;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-publish-source-preview', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-publish-source-preview', listener);
      };
    },
    onOpenCurrentTab: (callback: (event: { address: string; sourceTabId: string | null }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { address: string; sourceTabId: string | null },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:open-current-tab', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:open-current-tab', listener);
      };
    },
    onBookmarksOpen: (
      callback: (event: { accountId: string | null; address: string; sourceTabId: string | null }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { accountId: string | null; address: string; sourceTabId: string | null },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:bookmarks-open', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:bookmarks-open', listener);
      };
    },
    onNotificationClicked: (callback: (event: { tabId: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string }) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-app:notification-clicked', listener);

      return () => {
        ipcRenderer.removeListener('qdn-app:notification-clicked', listener);
      };
    },
    onAppTitleChanged: (callback: (event: { tabId: string; title: string | null }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string; title: string | null },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-views:app-title-changed', listener);

      return () => {
        ipcRenderer.removeListener('qdn-views:app-title-changed', listener);
      };
    },
    onAppAudioStateChanged: (callback: (event: {
      audible: boolean;
      muted: boolean;
      tabId: string;
    }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { audible: boolean; muted: boolean; tabId: string },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-views:app-audio-state-changed', listener);

      return () => {
        ipcRenderer.removeListener('qdn-views:app-audio-state-changed', listener);
      };
    },
    onAppNavigationChanged: (callback: (event: {
      activeIndex: number;
      entries: Array<{ index: number; url: string }>;
      resourceUrl: string;
      tabId: string;
    }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          activeIndex: number;
          entries: Array<{ index: number; url: string }>;
          resourceUrl: string;
          tabId: string;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('qdn-views:app-navigation-changed', listener);

      return () => {
        ipcRenderer.removeListener('qdn-views:app-navigation-changed', listener);
      };
    },
  },
});
