/// <reference types="vite/client" />

type QortiumAccountSummary = {
  address: string;
  addressIndex: number;
  id: string;
  isUnlocked: boolean;
  label: string;
  sourceFilename: string;
  supportsDerivedAddresses: boolean;
  walletId: string;
};

type QortiumAccountsState = {
  accounts: QortiumAccountSummary[];
  activeAccountId: string | null;
};

type QortiumAccountProfile = {
  accountId: string;
  address: string;
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

type QortiumWalletBackupResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      fileName: string;
      uri?: string;
    };

type QortiumAccountsCapabilities = {
  canCreateWallet: boolean;
  canExportWalletFile: boolean;
  canLoadWalletFile: boolean;
};

type QortiumNodeSettingsMode = 'custom' | 'local' | 'network';

type QortiumNodeSettings = {
  apiKey: string;
  customUrl: string;
  localUrl: string;
  mode: QortiumNodeSettingsMode;
  networkModeAvailable: boolean;
  networkSeedUrls: string[];
  nodeApiUrl: string;
};

type QortiumNodeSettingsRequest = {
  apiKey?: string;
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

type QortiumCoreAutoUpdateMode = 'CHECK_ONLY' | 'INSTALL' | 'NOTIFY' | 'OFF' | string;

type QortiumCoreOnChainUpdateStatus = {
  activeDownloadPeerCount?: number | null;
  autoUpdateMode?: QortiumCoreAutoUpdateMode;
  binaryBlockHeight?: number | null;
  binaryCreatorAddress?: string | null;
  binaryIdentifier?: string | null;
  binaryMethod?: string | null;
  binaryName?: string | null;
  binaryResourceLocalChunkCount?: number | null;
  binaryResourcePercentLoaded?: number | null;
  binaryResourceStatus?: string | null;
  binaryResourceTotalChunkCount?: number | null;
  binaryService?: string | null;
  binarySignature?: string | null;
  blockchainHeight?: number | null;
  commitHash?: string | null;
  currentBuildTimestamp?: number;
  devGroupIds?: number[] | null;
  downloadLastProgressAge?: number | null;
  downloadLastProgressTimestamp?: number | null;
  downloadRetryCount?: number | null;
  downloadStalled?: boolean | null;
  downloadStarted?: boolean;
  downloadStartedTimestamp?: number | null;
  installStarted?: boolean;
  installing?: boolean;
  manifestApprovalHeight?: number | null;
  manifestApprovalStatus?: string | null;
  manifestBlockHeight?: number | null;
  manifestCreatorAddress?: string | null;
  manifestSignature?: string | null;
  manifestTxGroupId?: number | null;
  message?: string | null;
  nextRetryTimestamp?: number | null;
  qdnEnabled?: boolean;
  qdnIdentifier?: string | null;
  qdnName?: string | null;
  qdnPath?: string | null;
  qdnService?: string | null;
  status?: string | null;
  updateAvailable?: boolean;
  updateTimestamp?: number | null;
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
      commit: string;
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
  runtimePath: string;
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
  apiKeyPath?: string;
  blocked?: {
    blockedAt: string;
    currentCoreTagName: string;
    currentNetworkId: string;
    currentPreviewChainSha256: string;
    existingCoreTagName: string;
    existingNetworkId: string;
    existingPreviewChainSha256: string;
    markerPath: string;
    message: string;
    runtimePath: string;
  };
  buildVersion?: string;
  jarPath?: string;
  localApiUrl: string;
  owner: 'external' | 'home' | 'unknown';
  pid?: number;
  running: boolean;
  runningCommit?: string;
  runningVersion?: string;
  runtimePath?: string;
  settingsPath?: string;
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

type QortiumI2pdProgress = QortiumCoreProgress;

// How i2pd is provided: 'managed' = Home runs it; 'external' = another SAM bridge
// is already listening (don't clobber it); 'none' = no router available.
type QortiumI2pdMode = 'external' | 'managed' | 'none';

type QortiumI2pdStatus = {
  supported: boolean;
  installed: boolean;
  version: string | null;
  running: boolean;
  mode: QortiumI2pdMode;
  samHost: string;
  samPort: number;
  binaryPath: string | null;
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
  installDir?: string;
  installFile?: string;
  platform: QortiumAppUpdatePlatform;
  updatesDir?: string;
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

type QortiumAppUpdateDownloadProgress = {
  action: 'downloading' | 'verifying';
  fileName: string;
  message: string;
  percent: number | null;
  receivedBytes: number;
  releaseTag: string;
  totalBytes: number | null;
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
  multiFile?: boolean;
  path?: string;
  suggestedFilename?: string;
};

type QortiumQdnResourcesSearchRequest = {
  exactMatchNames?: boolean;
  includeMetadata?: boolean;
  includeStatus?: boolean;
  limit?: number;
  name?: string;
  prefix?: boolean;
  service?: string;
};

type QortiumQdnNamesSearchRequest = {
  limit?: number;
  prefix?: boolean;
  query: string;
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

type QortiumQdnResourceDataResult = {
  data: string;
  contentType: string;
  contentLength: number;
  tooLarge?: boolean;
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

type QortiumQdnArchiveRenderResult = {
  renderUrl: string;
};

type QortiumQdnPreviewContentRequest = {
  kind?: 'directory' | 'file';
  path?: string;
};

type QortiumQdnPreviewContentResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      renderUrl: string;
      service: string;
      sourceKind: 'directory' | 'file';
      sourceName: string;
      sourcePath: string;
    };

type QortiumQdnViewBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type QortiumQdnDisplaySettings = {
  language: 'ar' | 'de' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hu' | 'it' | 'ja' | 'ko' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
  textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
  accent:
    | 'blue'
    | 'cyan'
    | 'green'
    | 'orange'
    | 'pink'
    | 'purple'
    | 'red'
    | 'teal'
    | 'yellow';
  theme: 'dark' | 'light';
};

type QortiumQdnViewShowRequest = {
  accountId: string | null;
  bounds: QortiumQdnViewBounds;
  displaySettings: QortiumQdnDisplaySettings;
  nodeApiUrl: string;
  renderUrl: string;
  resourceUrl?: string;
  tabId: string;
};

type QortiumQdnViewBoundsRequest = {
  bounds: QortiumQdnViewBounds;
  tabId: string;
};

type QortiumQdnViewDisplaySettingsRequest = {
  displaySettings: QortiumQdnDisplaySettings;
  tabId: string;
};

type QortiumQdnViewAccountStateRequest = {
  accountId: string | null;
  isUnlocked: boolean;
  tabId: string;
};

type QortiumQdnMediaPlayerRequest = {
  identifier: string | null;
  name: string;
  path: string | null;
  service: string;
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

type QortiumHomeMenuLabels = {
  back: string;
  closeTab: string;
  closeWindow: string;
  copy: string;
  cut: string;
  edit: string;
  file: string;
  focusAddressBar: string;
  forward: string;
  minimize: string;
  newTab: string;
  newWindow: string;
  paste: string;
  quit: string;
  redo: string;
  reloadTab: string;
  reopenClosedTab: string;
  resetZoom: string;
  selectAll: string;
  toggleFullScreen: string;
  undo: string;
  view: string;
  window: string;
  zoom: string;
  zoomIn: string;
  zoomOut: string;
};

type QortiumQdnWriteApprovalRequest = {
  accountName: string | null;
  action:
    | 'PUBLISH_MULTIPLE_QDN_RESOURCES'
    | 'PUBLISH_QDN_RESOURCE'
    | 'DELETE_QDN_RESOURCE'
    | 'APPROVE_GROUP_JOIN_REQUEST'
    | 'GROUP_APPROVAL'
    | 'INVITE_TO_GROUP'
    | 'JOIN_GROUP'
    | 'LEAVE_GROUP'
    | 'UPDATE_GROUP'
    | 'CREATE_GROUP'
    | 'ADD_GROUP_ADMIN'
    | 'REMOVE_GROUP_ADMIN'
    | 'GROUP_BAN'
    | 'CANCEL_GROUP_BAN'
    | 'GROUP_KICK'
    | 'CANCEL_GROUP_INVITE'
    | 'SET_GROUP'
    | 'PAYMENT'
    | 'SEND_COIN'
    | 'TRANSFER_ASSET'
    | 'CREATE_POLL'
    | 'VOTE_ON_POLL'
    | 'UPDATE_POLL'
    | 'RATE_ACCOUNT'
    | 'BUY_NAME'
    | 'CANCEL_SELL_NAME'
    | 'REGISTER_NAME'
    | 'SELL_NAME'
    | 'UPDATE_NAME'
    | 'SEND_CHAT_MESSAGE'
    | 'REQUEST_PRIVATE_GROUP_CHAT_KEY'
    | 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
    | 'START_MINTING'
    | 'REMOVE_MINTING_ACCOUNT';
  address: string;
  amount: string | null;
  approval: boolean | null;
  chatMessagePreview: string | null;
  groupId: number | null;
  groupName: string | null;
  id: string;
  mintingKey: string | null;
  name: string | null;
  permissionScope: 'single-request' | 'session';
  recipientAddress: string | null;
  resource: {
    identifier: string | null;
    name: string;
    service: string;
  } | null;
  resourceCount: number | null;
  resourceUrl: string;
  sourceKind: 'data' | 'directory' | 'file' | null;
  sourceName: string | null;
};

type QortiumQdnUnlockRequest = {
  accountId: string;
  accountLabel: string;
  accountName: string | null;
  address: string;
  id: string;
  resourceUrl: string;
};

interface Window {
  qortiumHome: {
    accounts: {
      list: () => Promise<QortiumAccountsState>;
      getCapabilities?: () => Promise<QortiumAccountsCapabilities>;
      getProfile: (accountId: string) => Promise<QortiumAccountProfile>;
      selectWalletFile: () => Promise<QortiumSelectWalletResult>;
      discardLoadedWallet: (token: string) => Promise<void>;
      saveLoadedWallet: (token: string, name: string) => Promise<QortiumAccountsState>;
      createWallet: (name: string, password: string) => Promise<QortiumCreateWalletResult>;
      getAddressFromPrivateKey: (privateKey: string) => Promise<string>;
      importPrivateKeyWallet: (
        name: string,
        privateKey: string,
        password: string,
      ) => Promise<QortiumCreateWalletResult>;
      exportWallet: (accountId: string) => Promise<QortiumWalletBackupResult>;
      setActiveAccount: (accountId: string) => Promise<QortiumAccountsState>;
      addDerivedAddress: (accountId: string) => Promise<QortiumAccountsState>;
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
    i2pd?: {
      getStatus: () => Promise<QortiumI2pdStatus>;
      install: () => Promise<QortiumI2pdStatus>;
      start: () => Promise<QortiumI2pdStatus>;
      stop: () => Promise<QortiumI2pdStatus>;
      onProgress: (callback: (progress: QortiumI2pdProgress) => void) => () => void;
    };
    updates: {
      downloadAsset: (
        request: QortiumAppUpdateDownloadRequest,
      ) => Promise<QortiumAppUpdateDownloadResult>;
      getEnvironment: () => Promise<QortiumAppUpdateEnvironment>;
      onDownloadProgress: (callback: (progress: QortiumAppUpdateDownloadProgress) => void) => () => void;
      openDownloadedFile: (filePath: string) => Promise<void>;
      openReleasePage: (url: string) => Promise<void>;
      showDownloadedFile: (filePath: string) => Promise<void>;
    };
    system?: {
      openPath: (filePath: string) => Promise<void>;
      revealPath: (filePath: string) => Promise<void>;
    };
    windows?: {
      closeCurrentWindow: () => Promise<void>;
      getStartupPayload: () => Promise<QortiumHomeWindowStartupPayload | null>;
      openDashboardWindow: () => Promise<void>;
      openTabInNewWindow: (request: QortiumHomeWindowOpenRequest) => Promise<void>;
    };
    menu?: {
      onCommand: (callback: (command: QortiumHomeMenuCommand) => void) => () => void;
      setLabels?: (labels: QortiumHomeMenuLabels) => Promise<void>;
    };
    node: {
      checkCoreUpdate: () => Promise<QortiumCoreOnChainUpdateStatus>;
      enableApiDocumentation: () => Promise<void>;
      getSettings: () => Promise<QortiumNodeSettings>;
      installCoreUpdate: () => Promise<QortiumCoreOnChainUpdateStatus>;
      saveSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
      setAllowedTransports: (transports: string[]) => Promise<void>;
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
      searchNames: (
        request: QortiumQdnNamesSearchRequest,
      ) => Promise<unknown>;
      fetchNodeApi: (
        request: QortiumNodeApiRequest,
      ) => Promise<QortiumNodeApiResult>;
      fetchResourceText: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnTextResult>;
      fetchResourceData: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnResourceDataResult>;
      prepareArchiveRender: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnArchiveRenderResult>;
      previewContent: (
        request: QortiumQdnPreviewContentRequest,
      ) => Promise<QortiumQdnPreviewContentResult>;
      downloadResource: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnDownloadResult>;
      openDownloadedResource?: (request: { uri: string; mimeType?: string }) => Promise<void>;
    };
    qdnViews?: {
      capture: (tabId: string) => Promise<string | null>;
      destroy: (tabId: string) => Promise<void>;
      hide: (tabId: string) => Promise<void>;
      setBounds: (request: QortiumQdnViewBoundsRequest) => Promise<void>;
      show: (request: QortiumQdnViewShowRequest) => Promise<void>;
      updateAccountState: (request: QortiumQdnViewAccountStateRequest) => Promise<void>;
      updateDisplaySettings: (request: QortiumQdnViewDisplaySettingsRequest) => Promise<void>;
    };
    qdnPermissions?: {
      onUnlockRequest?: (
        callback: (request: QortiumQdnUnlockRequest) => void,
      ) => () => void;
      onWriteRequest: (
        callback: (request: QortiumQdnWriteApprovalRequest) => void,
      ) => () => void;
      resolveUnlockRequest?: (requestId: string, approved: boolean) => Promise<void>;
      resolveWriteRequest: (requestId: string, approved: boolean) => Promise<void>;
    };
    qdnEvents?: {
      onOpenNewTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenMediaPlayer: (
        callback: (event: QortiumQdnMediaPlayerRequest) => void,
      ) => () => void;
      onOpenCurrentTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
    };
  };
}
