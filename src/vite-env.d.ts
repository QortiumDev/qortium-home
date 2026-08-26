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

type QortiumNodeCertificateStatus = {
  confirmationRequired: boolean;
  confirmedFingerprint: string | null;
  host: string;
  matchesConfirmed: boolean;
  nodeApiUrl: string;
  observeError: string | null;
  presented: {
    fingerprint: string;
    issuer: string;
    subject: string;
    validFrom: string;
    validTo: string;
  } | null;
  verifyCommand: string;
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

type QortiumCoreTransportStatusSnapshot = {
  chainPeers: Array<{ transport?: unknown }>;
  coreRunning?: boolean;
  dataPeers: Array<{ transport?: unknown }>;
  settings: {
    allowedTransports: string[] | null;
    i2pSamHost: string;
    i2pSamPort: number;
    i2pChainKeyFile: string;
    i2pDataKeyFile: string;
    i2pEmbeddedRouter: boolean;
  };
  source?: 'live-node' | 'managed-runtime';
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
type QortiumCoreUpdatePolicy = 'install' | 'notify' | 'off';

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
      commitTimestamp: string;
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
  helpersRefreshedFor?: string;
  installPath: string;
  installedAt: string;
  jarBuildTimestamp?: string;
  jarBuildVersion?: string;
  jarCommit?: string;
  jarPath: string;
  jarSemver?: string;
  logPaths: QortiumCoreLogPaths;
  modifiedSinceInstall?: boolean;
  name: string;
  originJarBuildVersion?: string;
  originJarCommit?: string;
  previewPath: string;
  reconciledAt?: string;
  runtimePath: string;
  tagName: string;
};

type QortiumCoreJavaStatus = {
  autoUpdateEnabled: boolean;
  available: boolean;
  majorVersion: number | null;
  managedJavaTarget: number;
  managedUpgradeAvailable: boolean;
  path: string;
  source: 'managed' | 'missing' | 'system' | 'unsupported';
  updateAvailableVersion: string | null;
  updatePolicy: QortiumCoreUpdatePolicy;
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
  coreUpdate: {
    available: {
      action: 'available' | 'handled-by-core' | 'installing';
      channel: 'github' | 'on-chain';
      commit?: string;
      githubChannel?: QortiumCoreChannel;
      timestamp?: string;
      version: string;
    } | null;
    checkedAt?: string;
    error?: string;
    helpersOutOfSync: {
      targetTag: string | null;
      version: string;
    } | null;
    javaUpdatePendingRestart?: boolean;
    nodeAutoUpdateMode?: string;
  };
  downgradeConfirmation?: {
    expiresAt: string;
    installedVersion: string;
    targetVersion: string;
    token: string;
  };
  installed: QortiumInstalledCore | null;
  java: QortiumCoreJavaStatus;
  runtime: QortiumCoreRuntimeStatus;
  supported: boolean;
  updateSettings: {
    coreUpdatePolicy: QortiumCoreUpdatePolicy;
    javaUpdatePolicy: QortiumCoreUpdatePolicy;
  };
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
  externalBinaryPath: string | null;
};

type QortiumAppUpdateChannel = 'prerelease' | 'stable';

type QortiumAppUpdatePlatformOs = 'android' | 'linux' | 'macos' | 'unsupported' | 'windows';

type QortiumAppUpdatePlatform = {
  arch: string;
  label: string;
  os: QortiumAppUpdatePlatformOs;
  osVersion?: string;
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
  allowMissing?: boolean;
  maxBytes?: number;
  mimeType?: string;
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
  missing?: boolean;
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
  sourceToken?: string;
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
      sourceToken?: string;
    };

type QortiumQdnViewBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type QortiumQdnDisplaySettings = {
  language: 'ar' | 'de' | 'el' | 'en' | 'es' | 'et' | 'fi' | 'fr' | 'he' | 'hi' | 'hu' | 'it' | 'ja' | 'ko' | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sv' | 'zh-CN' | 'zh-TW';
  textSize: 'extra-large' | 'extra-small' | 'huge' | 'large' | 'medium' | 'small';
  ui: 'classic' | 'modern' | 'fun';
  accent:
    | 'blue'
    | 'clay'
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
  managerRevisions?: import('../electron/qdn-manager-events').QdnManagerRevisions;
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

type QortiumQdnHomeSettingsChangedDetail = QortiumQdnDisplaySettings & {
  appNotifications: boolean;
  appZoom: number;
  lang: QortiumQdnDisplaySettings['language'];
  uiStyle: QortiumQdnDisplaySettings['ui'];
};

type QortiumQdnViewAccountStateRequest = {
  accountId: string | null;
  isUnlocked: boolean;
  tabId: string;
};

type QortiumQdnAppTargetMessage = {
  action: 'OPEN_APP_TARGET';
  requestedHandler: 'UI';
  query: { address?: string; group?: string };
};

type QortiumQdnViewPostMessageRequest = {
  message: QortiumQdnAppTargetMessage;
  tabId: string;
};

type QortiumQdnMediaPlayerRequest = {
  identifier: string | null;
  name: string;
  path: string | null;
  service: string;
};

type QortiumQdnDocumentViewerRequest = {
  identifier: string | null;
  name: string;
  path: string | null;
  service: string;
  // Filename hint for format detection (epub/pdf/cbz/txt) only - never used to
  // build the fetch URL. Single-file resources have no `path`, so without this
  // the viewer has nothing to detect the format from beyond an unreliable
  // node Content-Type header.
  filename?: string | null;
  mimeType?: string | null;
};

type QortiumQdnResourceViewerRequest = {
  identifier: string | null;
  name: string;
  path: string | null;
  service: string;
  filename?: string | null;
  mimeType?: string | null;
};

type QortiumQdnPublishSourcePreviewRequest = {
  renderUrl: string;
  service: string;
  sourceKind: 'directory' | 'file';
  sourceName: string;
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
  | 'reopen-closed-tab'
  | 'text-size-decrease'
  | 'text-size-increase'
  | 'text-size-reset';

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
    | 'SET_GROUP_AVATAR'
    | 'SET_ACCOUNT_AVATAR'
    | 'SET_CURRENT_FOREIGN_SERVER'
    | 'SEND_QORT'
    | 'SEND_QORTAL_GROUP_CHAT'
    | 'PAYMENT'
    | 'SEND_COIN'
    | 'TRANSFER_ASSET'
    | 'CREATE_POLL'
    | 'VOTE_ON_POLL'
    | 'UPDATE_POLL'
    | 'RATE_ACCOUNT'
    | 'RATE_RESOURCE'
    | 'BUY_NAME'
    | 'CANCEL_SELL_NAME'
    | 'REGISTER_NAME'
    | 'SELL_NAME'
    | 'UPDATE_NAME'
    | 'SEND_CHAT_MESSAGE'
    | 'SEND_MESSAGE'
    | 'SHOW_NOTIFICATION'
    | 'NOTIFICATION_ADD'
    | 'BOOKMARKS_GET'
    | 'BOOKMARKS_APPLY'
    | 'BOOKMARKS_OPEN'
    | 'NOTIFICATION_MANAGER_GET'
    | 'NOTIFICATION_MANAGER_SET_MUTED'
    | 'NOTIFICATION_MANAGER_REMOVE_RULES'
    | 'NOTIFICATION_MANAGER_REVOKE'
    | 'GET_APP_ASSIGNMENTS'
    | 'REQUEST_APP_ASSIGNMENT'
    | 'UPDATE_NODE_SETTINGS'
    | 'UPDATE_HOME_SETTINGS'
    | 'RESTART_NODE'
    | 'ADD_TO_LIST'
    | 'REMOVE_FROM_LIST'
    | 'REQUEST_PRIVATE_GROUP_CHAT_KEY'
    | 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
    | 'START_MINTING'
    | 'REMOVE_MINTING_ACCOUNT';
  address: string;
  amount: string | null;
  approval: boolean | null;
  chatMessagePreview: string | null;
  details: Array<{ label: string; value: string }>;
  groupId: number | null;
  groupName: string | null;
  id: string;
  mintingKey: string | null;
  name: string | null;
  permissionScope: 'always' | 'single-request' | 'session';
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
  homeV2Collections?: {
    readLegacy(): Promise<{
      hadData: boolean;
      snapshot: import('../electron/bookmark-manager-contract').BookmarkManagerSnapshot;
    }>;
    resolveRequest(response: {
      error?: { code?: string; message: string };
      requestId: string;
      result?: import('../electron/bookmark-manager-contract').BookmarkManagerMutationResult | import('../electron/bookmark-manager-contract').BookmarkManagerSnapshot;
    }): Promise<void>;
    onRequest(listener: (request: unknown) => void): () => void;
    onOpen(listener: (request: unknown) => void): () => void;
  };
  /**
   * The Home 2 Home-settings round-trip. Main asks, the shell answers; both
   * envelopes are defined by electron/home-v2-home-settings-contract.ts. Absent
   * on Android, where the renderer is the host and no IPC is involved.
   */
  homeV2HomeSettings?: {
    onRequest(listener: (request: unknown) => void): () => void;
    resolveRequest(response: {
      error?: { code?: string; message: string };
      requestId: string;
      settings?: import('../electron/home-v2-home-settings-contract').HomeV2HomeSettings;
    }): Promise<void>;
  };
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
      clearActiveAccount?: () => Promise<QortiumAccountsState>;
      renameAccount?: (accountId: string, label: string) => Promise<QortiumAccountsState>;
      addDerivedAddress: (accountId: string) => Promise<QortiumAccountsState>;
      unlockWallet: (accountId: string, password: string) => Promise<QortiumAccountsState>;
      lockWallet: (accountId: string) => Promise<QortiumAccountsState>;
      removeWallet: (accountId: string, password?: string) => Promise<QortiumAccountsState>;
    };
    appName: string;
    core?: {
      checkReleases: () => Promise<QortiumCoreReleases>;
      getStatus: () => Promise<QortiumCoreStatus>;
      install: (request: {
        allowDowngrade?: boolean;
        channel?: QortiumCoreChannel;
        downgradeToken?: string;
      }) => Promise<QortiumCoreStatus>;
      installJava: () => Promise<QortiumCoreStatus>;
      refreshHelpers: () => Promise<QortiumCoreStatus>;
      setJavaAutoUpdate: (enabled: boolean) => Promise<QortiumCoreStatus>;
      setUpdatePolicy: (request: {
        coreUpdatePolicy?: QortiumCoreUpdatePolicy;
        javaUpdatePolicy?: QortiumCoreUpdatePolicy;
      }) => Promise<QortiumCoreStatus>;
      onStatus: (callback: (status: QortiumCoreStatus) => void) => () => void;
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
      downloadReleaseAsset: (
        request: QortiumAppUpdateDownloadRequest,
      ) => Promise<QortiumAppUpdateDownloadResult>;
      getEnvironment: () => Promise<QortiumAppUpdateEnvironment>;
      onDownloadProgress: (callback: (progress: QortiumAppUpdateDownloadProgress) => void) => () => void;
      openDownloadedFile: (filePath: string, expectedDigest?: string) => Promise<void>;
      openReleasePage: (url: string) => Promise<void>;
      showDownloadedFile: (filePath: string) => Promise<void>;
    };
    system?: {
      openPath: (filePath: string) => Promise<void>;
      revealPath: (filePath: string) => Promise<void>;
      reportStartupPaint?: (navToPaintMs: number) => Promise<void>;
    };
    windows?: {
      closeCurrentWindow: () => Promise<void>;
      getStartupPayload: () => Promise<QortiumHomeWindowStartupPayload | null>;
      openDashboardWindow: () => Promise<void>;
      openTabInNewWindow: (request: QortiumHomeWindowOpenRequest) => Promise<void>;
    };
    zoom?: {
      get: () => Promise<number>;
      set: (percent: number) => Promise<number>;
      onChanged: (callback: (percent: number) => void) => () => void;
    };
    menu?: {
      onCommand: (callback: (command: QortiumHomeMenuCommand) => void) => () => void;
      setLabels?: (labels: QortiumHomeMenuLabels) => Promise<void>;
    };
    node: {
      checkCoreUpdate: () => Promise<QortiumCoreOnChainUpdateStatus>;
      confirmCertificate?: (
        nodeApiUrl: string,
        fingerprint: string,
      ) => Promise<QortiumNodeCertificateStatus>;
      enableApiDocumentation: () => Promise<void>;
      forgetCertificate?: (nodeApiUrl: string) => Promise<QortiumNodeCertificateStatus>;
      getCertificateStatus?: (nodeApiUrl: string) => Promise<QortiumNodeCertificateStatus>;
      hasStoredSettings?: () => Promise<boolean>;
      getSettings: () => Promise<QortiumNodeSettings>;
      getTransportStatus?: () => Promise<QortiumCoreTransportStatusSnapshot | null>;
      installCoreUpdate: () => Promise<QortiumCoreOnChainUpdateStatus>;
      saveSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
      setAllowedTransports: (transports: string[]) => Promise<void>;
      testConnection: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeStatusResult>;
      getStatus: () => Promise<QortiumNodeStatusResult>;
    };
    qdn: {
      hasNotificationStore?: () => Promise<boolean>;
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
      openResourceExternally?: (
        request: QortiumQdnRawResourceRequest,
      ) => Promise<QortiumQdnDownloadResult>;
      openDownloadedResource?: (request: { uri: string; mimeType?: string }) => Promise<void>;
      setAppNotificationsEnabled?: (enabled: boolean) => Promise<void>;
      getNotificationStore?: () => Promise<import('../electron/notification-rules').QdnNotificationStore>;
      onNotificationStoreChanged?: (callback: () => void) => () => void;
      setAppNotificationMuted?: (
        appKey: string,
        muted: boolean,
      ) => Promise<import('../electron/notification-rules').QdnNotificationStore>;
      revokeAppNotifications?: (
        appKey: string,
      ) => Promise<import('../electron/notification-rules').QdnNotificationStore>;
      getAppAssignmentsStore?: () => Promise<import('../electron/qdn-manager-permissions').QdnAppAssignmentsStore>;
      onAppAssignmentsChanged?: (callback: () => void) => () => void;
      setAppAssignment?: (input: {
        description?: unknown;
        label?: unknown;
        role: unknown;
        url: unknown;
      }) => Promise<import('../electron/qdn-manager-permissions').QdnAppAssignmentsStore>;
      migrateLegacyPreferredApps?: (
        legacyPreferredApps: unknown,
      ) => Promise<import('../electron/qdn-manager-permissions').QdnAppAssignmentsStore>;
    };
    qdnViews?: {
      broadcastHomeSettingsChanged: (detail: QortiumQdnHomeSettingsChangedDetail) => Promise<void>;
      capture: (tabId: string) => Promise<string | null>;
      destroy: (tabId: string) => Promise<void>;
      hide: (tabId: string) => Promise<void>;
      setAudioMuted?: (request: { muted: boolean; tabId: string }) => Promise<void>;
      setBounds: (request: QortiumQdnViewBoundsRequest) => Promise<void>;
      navigate: (request: { index: number; tabId: string }) => Promise<boolean>;
      show: (request: QortiumQdnViewShowRequest) => Promise<void>;
      updateAccountState: (request: QortiumQdnViewAccountStateRequest) => Promise<void>;
      updateDisplaySettings: (request: QortiumQdnViewDisplaySettingsRequest) => Promise<void>;
      updateManagerRevisions: (request: {
        managerRevisions: import('../electron/qdn-manager-events').QdnManagerRevisions;
        tabId: string;
      }) => Promise<void>;
      postMessage: (request: QortiumQdnViewPostMessageRequest) => Promise<void>;
    };
    qdnPermissions?: {
      onUnlockRequest?: (
        callback: (request: QortiumQdnUnlockRequest) => void,
      ) => () => void;
      onWriteRequest: (
        callback: (request: QortiumQdnWriteApprovalRequest) => void,
      ) => () => void;
      onHomeSettingsRequest?: (
        callback: (request: { id: string; operation: 'apply' | 'read'; patch: unknown }) => void,
      ) => () => void;
      onBookmarkManagerRequest?: (
        callback: (request: {
          id: string;
          operation: 'apply' | 'get';
          request: import('../electron/bookmark-manager-contract').BookmarkManagerMutationRequest | null;
        }) => void,
      ) => () => void;
      resolveUnlockRequest?: (requestId: string, approved: boolean) => Promise<void>;
      resolveWriteRequest: (requestId: string, approved: boolean) => Promise<void>;
      resolveHomeSettingsRequest?: (requestId: string, settings: unknown) => Promise<void>;
      resolveBookmarkManagerRequest?: (
        requestId: string,
        result: unknown,
        error?: { code?: string; message: string },
      ) => Promise<void>;
    };
    qdnEvents?: {
      onOpenNewTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenMediaPlayer: (
        callback: (event: QortiumQdnMediaPlayerRequest) => void,
      ) => () => void;
      onOpenDocumentViewer: (
        callback: (event: QortiumQdnDocumentViewerRequest) => void,
      ) => () => void;
      onOpenResourceViewer: (
        callback: (event: QortiumQdnResourceViewerRequest & { sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenPublishSourcePreview: (
        callback: (event: QortiumQdnPublishSourcePreviewRequest & { sourceTabId: string | null }) => void,
      ) => () => void;
      onOpenCurrentTab: (
        callback: (event: { address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onBookmarksOpen?: (
        callback: (event: { accountId: string | null; address: string; sourceTabId: string | null }) => void,
      ) => () => void;
      onNotificationClicked?: (
        callback: (event: { tabId: string }) => void,
      ) => () => void;
      onAppTitleChanged?: (
        callback: (event: { tabId: string; title: string | null }) => void,
      ) => () => void;
      onAppAudioStateChanged?: (
        callback: (event: { audible: boolean; muted: boolean; tabId: string }) => void,
      ) => () => void;
      onAppNavigationChanged?: (
        callback: (event: {
          activeIndex: number;
          entries: Array<{ index: number; url: string }>;
          resourceUrl: string;
          tabId: string;
        }) => void,
      ) => () => void;
    };
  };
}
