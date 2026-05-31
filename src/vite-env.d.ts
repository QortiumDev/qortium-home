/// <reference types="vite/client" />

type QortiumAccountSummary = {
  address: string;
  id: string;
  isUnlocked: boolean;
  label: string;
  sourceFilename: string;
};

type QortiumAccountsState = {
  accounts: QortiumAccountSummary[];
  activeAccountId: string | null;
};

type QortiumAccountProfile = {
  accountId: string;
  address: string;
  avatarUrl: string | null;
  label: string;
  name: string | null;
};

type QortiumSelectWalletResult =
  | {
      canceled: true;
    }
  | {
      accountId: string;
      address: string;
      canceled: false;
      suggestedName: string;
      token: string;
    };

type QortiumCreateWalletResult = QortiumAccountsState & {
  canceled: boolean;
};

type QortiumNodeSettingsMode = 'custom' | 'local' | 'network';

type QortiumNodeSettings = {
  customUrl: string;
  localUrl: string;
  mode: QortiumNodeSettingsMode;
  networkModeAvailable: boolean;
  networkSeedUrls: string[];
  nodeApiUrl: string;
};

type QortiumNodeSettingsRequest = {
  customUrl?: string;
  mode: QortiumNodeSettingsMode;
};

type QortiumNodeStatusResult =
  | {
      nodeApiUrl: string;
      ok: true;
      status: unknown;
    }
  | {
      message: string;
      nodeApiUrl: string;
      ok: false;
    };

type QortiumCoreChannel = 'prerelease' | 'stable';

type QortiumCoreReleaseAsset = {
  digest: string | null;
  downloadUrl: string;
  name: string;
  size: number;
};

type QortiumCoreReleaseSummary =
  | {
      available: false;
      channel: QortiumCoreChannel;
      message: string;
    }
  | {
      asset: QortiumCoreReleaseAsset;
      available: true;
      channel: QortiumCoreChannel;
      htmlUrl: string;
      name: string;
      publishedAt: string;
      tagName: string;
    };

type QortiumCoreReleases = {
  prerelease: QortiumCoreReleaseSummary;
  stable: QortiumCoreReleaseSummary;
};

type QortiumCoreLogPaths = {
  appLogPath: string;
  launcherLogPath: string;
  windowsErrorLogPath?: string;
};

type QortiumInstalledCore = {
  assetName: string;
  assetSize: number;
  channel: QortiumCoreChannel;
  digest: string | null;
  downloadUrl: string;
  htmlUrl: string;
  installPath: string;
  installedAt: string;
  jarPath: string;
  logPaths: QortiumCoreLogPaths;
  name: string;
  previewPath: string;
  tagName: string;
};

type QortiumCoreJavaStatus = {
  available: boolean;
  majorVersion: number | null;
  path: string;
  source: 'managed' | 'missing' | 'system' | 'unsupported';
  version: string | null;
};

type QortiumCoreRuntimeStatus = {
  localApiUrl: string;
  running: boolean;
  status: unknown;
};

type QortiumCoreStatus = {
  installed: QortiumInstalledCore | null;
  java: QortiumCoreJavaStatus;
  runtime: QortiumCoreRuntimeStatus;
  supported: boolean;
};

type QortiumCoreProgress = {
  action: 'checking' | 'downloading' | 'extracting' | 'idle' | 'starting' | 'stopping';
  kind: 'error' | 'info' | 'success';
  message: string;
  percent?: number;
};

type QortiumAppUpdateChannel = 'prerelease' | 'stable';

type QortiumAppUpdatePlatformOs = 'android' | 'linux' | 'macos' | 'unsupported' | 'windows';

type QortiumAppUpdatePlatform = {
  arch: string;
  label: string;
  os: QortiumAppUpdatePlatformOs;
  supported: boolean;
};

type QortiumAppUpdateEnvironment = {
  currentVersion: string;
  platform: QortiumAppUpdatePlatform;
};

type QortiumAppUpdateAsset = {
  digest: string | null;
  downloadUrl: string;
  name: string;
  size: number;
};

type QortiumAppUpdateRelease = {
  channel: QortiumAppUpdateChannel;
  htmlUrl: string;
  name: string;
  prerelease: boolean;
  publishedAt: string;
  tagName: string;
};

type QortiumAppUpdateStatus =
  | 'available'
  | 'error'
  | 'no-compatible-asset'
  | 'not-found'
  | 'unsupported'
  | 'up-to-date';

type QortiumAppUpdateCheckResult = {
  asset?: QortiumAppUpdateAsset;
  channel: QortiumAppUpdateChannel;
  checkedAt: string;
  comparison?: number;
  currentVersion: string;
  message: string;
  platform: QortiumAppUpdatePlatform;
  release?: QortiumAppUpdateRelease;
  status: QortiumAppUpdateStatus;
};

type QortiumAppUpdateDownloadRequest = {
  asset: QortiumAppUpdateAsset;
  platform: QortiumAppUpdatePlatform;
  releaseTag: string;
};

type QortiumAppUpdateDownloadResult = {
  canOpen: boolean;
  canReveal: boolean;
  digest: string;
  digestVerified: boolean;
  downloadedAt: string;
  fileName: string;
  filePath: string;
  releaseTag: string;
  size: number;
};

type QortiumQdnAuthorizeRequest = {
  identifier?: string;
  name: string;
  service: string;
};

type QortiumQdnAuthorizeResult = {
  authorized: true;
  nodeApiUrl: string;
};

type QortiumQdnRawResourceRequest = QortiumQdnAuthorizeRequest & {
  maxBytes?: number;
  path?: string;
  suggestedFilename?: string;
};

type QortiumQdnResourcesSearchRequest = {
  exactMatchNames?: boolean;
  includeMetadata?: boolean;
  includeStatus?: boolean;
  limit?: number;
  name?: string;
  service?: string;
};

type QortiumQdnTextResult =
  | {
      content: string;
      contentLength?: number;
      contentType?: string;
      tooLarge: false;
    }
  | {
      contentLength?: number;
      contentType?: string;
      tooLarge: true;
    };

type QortiumNodeApiRequest = {
  maxBytes?: number;
  method?: 'GET' | 'HEAD';
  path: string;
};

type QortiumNodeApiResult =
  | {
      body: string;
      contentLength?: number;
      contentType: string;
      status: number;
      statusText: string;
      tooLarge: false;
    }
  | {
      contentLength?: number;
      contentType: string;
      status: number;
      statusText: string;
      tooLarge: true;
    };

type QortiumQdnDownloadResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      fileName?: string;
      filePath: string;
      opened?: boolean;
      size?: number;
    };

type QortiumQdnViewBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type QortiumQdnViewShowRequest = {
  accountId: string | null;
  bounds: QortiumQdnViewBounds;
  nodeApiUrl: string;
  renderUrl: string;
  tabId: string;
};

type QortiumQdnViewBoundsRequest = {
  bounds: QortiumQdnViewBounds;
  tabId: string;
};

type QortiumHomeRouteSnapshot = {
  displayUrl: string;
  kind: string;
  [key: string]: unknown;
};

type QortiumHomeRouteHistorySnapshot = {
  entries: QortiumHomeRouteSnapshot[];
  index: number;
};

type QortiumHomeTabSnapshot = {
  accountId: string | null;
  history: QortiumHomeRouteHistorySnapshot;
};

type QortiumHomeWindowOpenRequest = {
  tab: QortiumHomeTabSnapshot;
};

type QortiumHomeWindowStartupPayload = {
  tab: QortiumHomeTabSnapshot;
};

type QortiumHomeMenuCommand =
  | 'close-tab'
  | 'focus-address-bar'
  | 'go-back'
  | 'go-forward'
  | 'new-tab'
  | 'reload-tab'
  | 'reopen-closed-tab';

type QortiumQdnAccountReadApprovalRequest = {
  action: 'GET_SELECTED_ACCOUNT';
  address: string;
  avatarUrl: string | null;
  id: string;
  name: string | null;
  resourceUrl: string;
};

type QortiumQdnWriteApprovalRequest = {
  accountName: string | null;
  action: 'PUBLISH_QDN_RESOURCE' | 'DELETE_QDN_RESOURCE';
  address: string;
  id: string;
  resource: {
    identifier: string | null;
    name: string;
    service: string;
  };
  resourceUrl: string;
  sourceKind: 'directory' | 'file' | null;
  sourceName: string | null;
};

interface Window {
  qortiumHome: {
    accounts: {
      list: () => Promise<QortiumAccountsState>;
      getProfile: (accountId: string) => Promise<QortiumAccountProfile>;
      selectWalletFile: () => Promise<QortiumSelectWalletResult>;
      discardLoadedWallet: (token: string) => Promise<void>;
      saveLoadedWallet: (token: string, name: string) => Promise<QortiumAccountsState>;
      createWallet: (name: string, password: string) => Promise<QortiumCreateWalletResult>;
      setActiveAccount: (accountId: string) => Promise<QortiumAccountsState>;
      unlockWallet: (accountId: string, password: string) => Promise<QortiumAccountsState>;
      lockWallet: (accountId: string) => Promise<QortiumAccountsState>;
      removeWallet: (accountId: string, password?: string) => Promise<QortiumAccountsState>;
    };
    appName: string;
    core?: {
      checkReleases: () => Promise<QortiumCoreReleases>;
      getStatus: () => Promise<QortiumCoreStatus>;
      install: (request: { channel?: QortiumCoreChannel }) => Promise<QortiumCoreStatus>;
      installJava: () => Promise<QortiumCoreStatus>;
      onProgress: (callback: (progress: QortiumCoreProgress) => void) => () => void;
      start: () => Promise<QortiumCoreStatus>;
      stop: () => Promise<QortiumCoreStatus>;
    };
    updates: {
      downloadAsset: (
        request: QortiumAppUpdateDownloadRequest,
      ) => Promise<QortiumAppUpdateDownloadResult>;
      getEnvironment: () => Promise<QortiumAppUpdateEnvironment>;
      openDownloadedFile: (filePath: string) => Promise<void>;
      openReleasePage: (url: string) => Promise<void>;
      showDownloadedFile: (filePath: string) => Promise<void>;
    };
    windows?: {
      closeCurrentWindow: () => Promise<void>;
      getStartupPayload: () => Promise<QortiumHomeWindowStartupPayload | null>;
      openDashboardWindow: () => Promise<void>;
      openTabInNewWindow: (request: QortiumHomeWindowOpenRequest) => Promise<void>;
    };
    menu?: {
      onCommand: (callback: (command: QortiumHomeMenuCommand) => void) => () => void;
    };
    node: {
      getSettings: () => Promise<QortiumNodeSettings>;
      saveSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
      testConnection: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeStatusResult>;
      getStatus: () => Promise<QortiumNodeStatusResult>;
    };
    qdn: {
      authorizeResource: (
        request: QortiumQdnAuthorizeRequest,
      ) => Promise<QortiumQdnAuthorizeResult>;
      listResources: (
        request: QortiumQdnResourcesSearchRequest,
      ) => Promise<unknown>;
      fetchNodeApi: (
        request: QortiumNodeApiRequest,
      ) => Promise<QortiumNodeApiResult>;
      fetchResourceText: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnTextResult>;
      downloadResource: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnDownloadResult>;
    };
    qdnViews?: {
      destroy: (tabId: string) => Promise<void>;
      hide: (tabId: string) => Promise<void>;
      setBounds: (request: QortiumQdnViewBoundsRequest) => Promise<void>;
      show: (request: QortiumQdnViewShowRequest) => Promise<void>;
    };
    qdnPermissions?: {
      onAccountReadRequest: (
        callback: (request: QortiumQdnAccountReadApprovalRequest) => void,
      ) => () => void;
      onWriteRequest: (
        callback: (request: QortiumQdnWriteApprovalRequest) => void,
      ) => () => void;
      resolveAccountReadRequest: (requestId: string, approved: boolean) => Promise<void>;
      resolveWriteRequest: (requestId: string, approved: boolean) => Promise<void>;
    };
  };
}
