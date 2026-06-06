import './styles.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ApiViewer } from './ApiViewer';
import { useAppUpdates } from './appUpdateState';
import { useCoreManager } from './coreManagerState';
import { DashboardPage } from './DashboardPage';
import { useOnChainCoreUpdate } from './onChainCoreUpdateState';
import { QdnExplorer } from './QdnExplorer';
import { QdnViewer } from './QdnViewer';
import { SettingsPage, type SettingsExpansionState, type SettingsSectionId } from './SettingsPage';
import { TopBar } from './TopBar';
import { DASHBOARD_ROUTE, SETTINGS_ROUTE, parseAppAddress, type AppRoute } from './routes';

type RouteHistoryState = {
  entries: AppRoute[];
  index: number;
};

type BrowserTab = {
  accountId: string | null;
  history: RouteHistoryState;
  id: string;
  reloadNonce: number;
};

type BrowserTabState = {
  activeTabId: string;
  closedTabs: ClosedBrowserTab[];
  tabs: BrowserTab[];
};

type ClosedBrowserTab = {
  accountId: string | null;
  history: RouteHistoryState;
  label: string;
};

type TabDropPosition = 'after' | 'before';

type RemoveTabOptions = {
  addToClosedHistory: boolean;
};

type NavigationActions = {
  canGoBack: boolean;
  canGoForward: boolean;
  currentRoute: AppRoute;
  goBack: () => void;
  goForward: () => void;
  goHome: () => void;
};

type NavigationSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
};

type QdnAccountReadDialogProps = {
  request: QortiumQdnAccountReadApprovalRequest;
  onResolve: (requestId: string, approved: boolean) => void;
};

type QdnWriteDialogProps = {
  request: QortiumQdnWriteApprovalRequest;
  onResolve: (requestId: string, approved: boolean) => void;
};

type TabCommandActions = {
  addTab: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  closeActiveTab: () => void;
  closeCurrentWindow: () => void;
  focusAddressBar: () => void;
  goBack: () => void;
  goForward: () => void;
  openDashboardWindow: () => void;
  reloadActiveTab: () => void;
  reopenClosedTab: () => void;
  selectLastTab: () => void;
  selectNextTab: () => void;
  selectPreviousTab: () => void;
  selectTabByIndex: (index: number) => void;
};

let nextTabId = 1;

const EMPTY_ACCOUNTS_STATE: QortiumAccountsState = {
  accounts: [],
  activeAccountId: null,
};
const CLOSED_TAB_HISTORY_LIMIT = 20;
const NAVIGATION_SWIPE_MIN_DISTANCE_PX = 72;
const NAVIGATION_SWIPE_MAX_VERTICAL_PX = 80;
const NAVIGATION_SWIPE_HORIZONTAL_RATIO = 1.6;
const NAVIGATION_SWIPE_VERTICAL_CANCEL_PX = 48;
const INITIAL_SETTINGS_EXPANSION: SettingsExpansionState = {
  core: false,
  home: false,
  node: true,
};

function accountExists(accountsState: QortiumAccountsState, accountId: string | null) {
  return !!accountId && accountsState.accounts.some((account) => account.id === accountId);
}

function getDefaultAccountId(accountsState: QortiumAccountsState) {
  if (accountExists(accountsState, accountsState.activeAccountId)) {
    return accountsState.activeAccountId;
  }

  return accountsState.accounts[0]?.id ?? null;
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Account action failed.';
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function createBrowserTabId() {
  const id = `tab-${nextTabId}`;

  nextTabId += 1;

  return id;
}

function cloneRouteHistory(history: RouteHistoryState): RouteHistoryState {
  return {
    entries: [...history.entries],
    index: Math.max(0, Math.min(history.entries.length - 1, history.index)),
  };
}

function createBrowserTab(accountId: string | null = null, history?: RouteHistoryState): BrowserTab {
  return {
    accountId,
    id: createBrowserTabId(),
    history: history ? cloneRouteHistory(history) : {
      entries: [DASHBOARD_ROUTE],
      index: 0,
    },
    reloadNonce: 0,
  };
}

function createClosedTabSnapshot(tab: BrowserTab): ClosedBrowserTab {
  return {
    accountId: tab.accountId,
    history: cloneRouteHistory(tab.history),
    label: getTabLabel(tab),
  };
}

function createRouteHistorySnapshot(history: RouteHistoryState): QortiumHomeRouteHistorySnapshot {
  const routeHistory = cloneRouteHistory(history);

  return {
    entries: routeHistory.entries.map((entry) => ({ ...entry }) as QortiumHomeRouteSnapshot),
    index: routeHistory.index,
  };
}

function createWindowTabSnapshot(tab: BrowserTab): QortiumHomeTabSnapshot {
  return {
    accountId: tab.accountId,
    history: createRouteHistorySnapshot(tab.history),
  };
}

function createRouteHistoryFromSnapshot(history: QortiumHomeRouteHistorySnapshot): RouteHistoryState {
  const entries = history.entries
    .map((entry) => parseAppAddress(entry.displayUrl))
    .filter((result): result is { route: AppRoute; success: true } => result.success)
    .map((result) => result.route);

  if (entries.length === 0) {
    return {
      entries: [DASHBOARD_ROUTE],
      index: 0,
    };
  }

  return {
    entries,
    index: Math.max(0, Math.min(entries.length - 1, history.index)),
  };
}

function createBrowserTabFromWindowSnapshot(tab: QortiumHomeTabSnapshot) {
  return createBrowserTab(tab.accountId, createRouteHistoryFromSnapshot(tab.history));
}

function createBrowserTabFromClosedTab(tab: ClosedBrowserTab, accountsState: QortiumAccountsState) {
  const currentRoute = tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;
  const accountId = accountExists(accountsState, tab.accountId)
    ? tab.accountId
    : currentRoute.kind === 'dashboard'
      ? getDefaultAccountId(accountsState)
      : null;

  return createBrowserTab(accountId, tab.history);
}

function getCurrentRouteForTab(tab: BrowserTab) {
  return tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;
}

function getQdnViewRouteKey(tab: BrowserTab) {
  return `${tab.reloadNonce}:${getCurrentRouteForTab(tab).displayUrl}`;
}

function createInitialTabState(): BrowserTabState {
  const tab = createBrowserTab();

  return {
    activeTabId: tab.id,
    closedTabs: [],
    tabs: [tab],
  };
}

function QdnAccountReadDialog({ request, onResolve }: QdnAccountReadDialogProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onResolve(request.id, false);
        }
      }}
    >
      <section
        aria-label="QDN account request"
        aria-modal="true"
        className="unlock-dialog qdn-permission-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="unlock-dialog__title">Share Account</h2>
        <p className="unlock-dialog__account">{request.name || 'Selected account'}</p>
        <p className="unlock-dialog__address">{request.address}</p>
        <p className="qdn-permission-dialog__resource">{request.resourceUrl}</p>
        <div className="unlock-dialog__actions">
          <button className="button button--secondary" type="button" onClick={() => onResolve(request.id, false)}>
            Deny
          </button>
          <button className="button" type="button" onClick={() => onResolve(request.id, true)}>
            Allow
          </button>
        </div>
      </section>
    </div>
  );
}

function getQdnWriteActionLabel(action: QortiumQdnWriteApprovalRequest['action']) {
  switch (action) {
    case 'PUBLISH_QDN_RESOURCE':
      return 'Publish QDN Resource';
    case 'DELETE_QDN_RESOURCE':
      return 'Delete QDN Resource';
    case 'JOIN_GROUP':
      return 'Join Group';
    case 'SEND_CHAT_MESSAGE':
      return 'Send Chat Message';
    case 'READ_PRIVATE_GROUP_CHAT':
      return 'Read Private Group Chat';
    case 'READ_PRIVATE_DIRECT_CHAT':
      return 'Read Direct Private Chat';
    default:
      return 'QDN Write';
  }
}

function getQdnWriteResourceLabel(resource: QortiumQdnWriteApprovalRequest['resource']) {
  if (!resource) {
    return '';
  }

  return `${resource.service}/${resource.name}${resource.identifier ? `/${resource.identifier}` : ''}`;
}

function getQdnWriteGroupLabel(request: QortiumQdnWriteApprovalRequest) {
  if (typeof request.groupId !== 'number') {
    return '';
  }

  return request.groupName ? `${request.groupName} (${request.groupId})` : String(request.groupId);
}

function QdnWriteDialog({ request, onResolve }: QdnWriteDialogProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onResolve(request.id, false);
        }
      }}
    >
      <section
        aria-label="QDN write request"
        aria-modal="true"
        className="unlock-dialog qdn-permission-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="unlock-dialog__title">Approve Request</h2>
        <p className="unlock-dialog__account">{request.accountName || 'Selected account'}</p>
        <p className="unlock-dialog__address">{request.address}</p>
        <p className="qdn-permission-dialog__resource">{request.resourceUrl}</p>
        <dl className="detail-list qdn-permission-dialog__details">
          <div>
            <dt>Action</dt>
            <dd>{getQdnWriteActionLabel(request.action)}</dd>
          </div>
          {request.resource ? (
            <div>
              <dt>Resource</dt>
              <dd>{getQdnWriteResourceLabel(request.resource)}</dd>
            </div>
          ) : null}
          {typeof request.groupId === 'number' ? (
            <div>
              <dt>Group</dt>
              <dd>{getQdnWriteGroupLabel(request)}</dd>
            </div>
          ) : null}
          {request.recipientAddress ? (
            <div>
              <dt>Recipient</dt>
              <dd>{request.recipientAddress}</dd>
            </div>
          ) : null}
          {request.chatMessagePreview ? (
            <div>
              <dt>Message</dt>
              <dd>{request.chatMessagePreview}</dd>
            </div>
          ) : null}
          {request.permissionScope === 'session' ? (
            <div>
              <dt>Scope</dt>
              <dd>This tab session</dd>
            </div>
          ) : null}
          {request.sourceName ? (
            <div>
              <dt>{request.sourceKind === 'directory' ? 'Folder' : 'File'}</dt>
              <dd>{request.sourceName}</dd>
            </div>
          ) : null}
        </dl>
        <div className="unlock-dialog__actions">
          <button className="button button--secondary" type="button" onClick={() => onResolve(request.id, false)}>
            Deny
          </button>
          <button className="button" type="button" onClick={() => onResolve(request.id, true)}>
            Approve
          </button>
        </div>
      </section>
    </div>
  );
}

function getTabLabel(tab: BrowserTab) {
  const route = tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;

  if (route.kind === 'dashboard') {
    return 'Dashboard';
  }

  if (route.kind === 'settings') {
    return 'Settings';
  }

  return route.displayUrl;
}

function shouldIgnoreNavigationSwipe(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return true;
  }

  return !!target.closest(
    [
      'a',
      'audio',
      'button',
      'iframe',
      'input',
      'select',
      'textarea',
      'video',
      '[contenteditable="true"]',
      '.qdn-viewer__text-content',
    ].join(','),
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

function isAddressBarShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return !!target.closest('#browser-address');
}

function isPrimaryShortcutModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

function shouldUseKeyboardShortcut(event: KeyboardEvent) {
  return !event.defaultPrevented && !event.isComposing;
}

export function App() {
  const [accountsState, setAccountsState] = useState<QortiumAccountsState>(EMPTY_ACCOUNTS_STATE);
  const [accountsError, setAccountsError] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [nodeSettings, setNodeSettings] = useState<QortiumNodeSettings | null>(null);
  const [nodeSettingsError, setNodeSettingsError] = useState('');
  const [qdnAccountReadRequests, setQdnAccountReadRequests] = useState<QortiumQdnAccountReadApprovalRequest[]>([]);
  const [qdnWriteRequests, setQdnWriteRequests] = useState<QortiumQdnWriteApprovalRequest[]>([]);
  const [tabState, setTabState] = useState<BrowserTabState>(createInitialTabState);
  const [settingsExpansion, setSettingsExpansion] = useState<SettingsExpansionState>(INITIAL_SETTINGS_EXPANSION);
  const [isLoadingWindowStartupPayload, setIsLoadingWindowStartupPayload] = useState(true);
  const tabCommandActionsRef = useRef<TabCommandActions | null>(null);
  const navigationActionsRef = useRef<NavigationActions | null>(null);
  const navigationSwipeRef = useRef<NavigationSwipeState | null>(null);
  const qdnViewRouteKeysRef = useRef<Map<string, string>>(new Map());
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? tabState.tabs[0];
  const activeAccount =
    accountsState.accounts.find((account) => account.id === activeTab.accountId) ?? null;
  const routeHistory = activeTab.history;
  const currentRoute = routeHistory.entries[routeHistory.index] ?? DASHBOARD_ROUTE;
  const routeRenderKey = `${activeTab.id}:${activeTab.reloadNonce}:${currentRoute.displayUrl}`;
  const isDashboardRoute = currentRoute.kind === 'dashboard';
  const isSettingsRoute = currentRoute.kind === 'settings';
  const isViewerRoute = !isDashboardRoute && !isSettingsRoute;
  const canGoBack = routeHistory.index > 0;
  const canGoForward = routeHistory.index < routeHistory.entries.length - 1;
  const activeQdnAccountReadRequest = qdnAccountReadRequests[0] ?? null;
  const activeQdnWriteRequest = qdnWriteRequests[0] ?? null;
  const isQdnPermissionDialogActive = !!activeQdnAccountReadRequest || !!activeQdnWriteRequest;

  useEffect(() => {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    if (!qdnPermissions?.onAccountReadRequest) {
      return undefined;
    }

    return qdnPermissions.onAccountReadRequest((request) => {
      setQdnAccountReadRequests((currentRequests) => {
        if (currentRequests.some((currentRequest) => currentRequest.id === request.id)) {
          return currentRequests;
        }

        return [...currentRequests, request];
      });
    });
  }, []);

  useEffect(() => {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    if (!qdnPermissions?.onWriteRequest) {
      return undefined;
    }

    return qdnPermissions.onWriteRequest((request) => {
      setQdnWriteRequests((currentRequests) => {
        if (currentRequests.some((currentRequest) => currentRequest.id === request.id)) {
          return currentRequests;
        }

        return [...currentRequests, request];
      });
    });
  }, []);

  function resolveQdnAccountReadRequest(requestId: string, approved: boolean) {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    setQdnAccountReadRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== requestId),
    );

    if (!qdnPermissions) {
      return;
    }

    void qdnPermissions.resolveAccountReadRequest(requestId, approved).catch((error) => {
      console.warn('Unable to resolve QDN account request.', error);
    });
  }

  function resolveQdnWriteRequest(requestId: string, approved: boolean) {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    setQdnWriteRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== requestId),
    );

    if (!qdnPermissions?.resolveWriteRequest) {
      return;
    }

    void qdnPermissions.resolveWriteRequest(requestId, approved).catch((error) => {
      console.warn('Unable to resolve QDN write request.', error);
    });
  }

  useLayoutEffect(() => {
    const qdnViews = window.qortiumHome.qdnViews;

    if (!qdnViews) {
      return;
    }

    const nextRouteKeys = new Map(tabState.tabs.map((tab) => [tab.id, getQdnViewRouteKey(tab)]));

    for (const [tabId, previousRouteKey] of qdnViewRouteKeysRef.current) {
      const nextRouteKey = nextRouteKeys.get(tabId);

      if (!nextRouteKey || nextRouteKey !== previousRouteKey) {
        void qdnViews.destroy(tabId).catch((error) => {
          console.warn('Unable to destroy stale isolated QDN view.', error);
        });
      }
    }

    qdnViewRouteKeysRef.current = nextRouteKeys;
  }, [tabState.tabs]);

  useEffect(() => {
    let isDisposed = false;
    const windowsApi = window.qortiumHome.windows;

    async function loadWindowStartupPayload() {
      if (!windowsApi) {
        setIsLoadingWindowStartupPayload(false);
        return;
      }

      try {
        const startupPayload = await windowsApi.getStartupPayload();

        if (!isDisposed && startupPayload?.tab) {
          const tab = createBrowserTabFromWindowSnapshot(startupPayload.tab);

          setTabState({
            activeTabId: tab.id,
            closedTabs: [],
            tabs: [tab],
          });
        }
      } catch (error) {
        console.warn('Unable to load window startup tab.', error);
      } finally {
        if (!isDisposed) {
          setIsLoadingWindowStartupPayload(false);
        }
      }
    }

    void loadWindowStartupPayload();

    return () => {
      isDisposed = true;
    };
  }, []);

  function reconcileTabsWithAccounts(nextAccountsState: QortiumAccountsState) {
    setTabState((currentTabState) => {
      const defaultAccountId = getDefaultAccountId(nextAccountsState);
      const tabs = currentTabState.tabs.map((tab) => {
        if (accountExists(nextAccountsState, tab.accountId)) {
          return tab;
        }

        const currentRoute = tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;
        const nextAccountId = tab.accountId && currentRoute.kind !== 'dashboard' ? null : defaultAccountId;

        if (tab.accountId === nextAccountId) {
          return tab;
        }

        return {
          ...tab,
          accountId: nextAccountId,
        };
      });

      return {
        ...currentTabState,
        tabs,
      };
    });
  }

  function handleAccountsStateChange(nextAccountsState: QortiumAccountsState) {
    setAccountsState(nextAccountsState);
    setAccountsError('');
    reconcileTabsWithAccounts(nextAccountsState);
  }

  useEffect(() => {
    let isDisposed = false;

    async function loadNodeSettings() {
      try {
        const settings = await window.qortiumHome.node.getSettings();

        if (!isDisposed) {
          setNodeSettings(settings);
          setNodeSettingsError('');
        }
      } catch (error) {
        if (!isDisposed) {
          setNodeSettingsError(error instanceof Error ? error.message : 'Unable to load node settings.');
        }
      }
    }

    void loadNodeSettings();

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    window.qortiumHome.accounts
      .list()
      .then((nextAccountsState) => {
        if (!isDisposed) {
          handleAccountsStateChange(nextAccountsState);
        }
      })
      .catch((error) => {
        if (!isDisposed) {
          setAccountsError(formatError(error));
        }
      })
      .finally(() => {
        if (!isDisposed) {
          setIsLoadingAccounts(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  async function saveNodeSettings(request: QortiumNodeSettingsRequest) {
    const settings = await window.qortiumHome.node.saveSettings(request);

    setNodeSettings(settings);

    return settings;
  }

  const updateResolvedNodeApiUrl = useCallback((nodeApiUrl: string) => {
    setNodeSettings((currentSettings) => {
      if (
        !currentSettings ||
        currentSettings.mode !== 'network' ||
        currentSettings.nodeApiUrl === nodeApiUrl
      ) {
        return currentSettings;
      }

      return {
        ...currentSettings,
        nodeApiUrl,
      };
    });
  }, []);

  const appUpdates = useAppUpdates({ autoCheck: true });
  const coreManager = useCoreManager({
    onResolvedNodeApiUrl: updateResolvedNodeApiUrl,
    onSaveNodeSettings: saveNodeSettings,
  });
  const onChainCoreUpdate = useOnChainCoreUpdate(nodeSettings);

  function updateSettingsSectionExpansion(sectionId: SettingsSectionId, isExpanded: boolean) {
    setSettingsExpansion((currentExpansion) => ({
      ...currentExpansion,
      [sectionId]: isExpanded,
    }));
  }

  function updateActiveTab(updateTab: (tab: BrowserTab) => BrowserTab) {
    setTabState((currentTabState) => ({
      ...currentTabState,
      tabs: currentTabState.tabs.map((tab) =>
        tab.id === currentTabState.activeTabId ? updateTab(tab) : tab,
      ),
    }));
  }

  function updateActiveTabHistory(updateHistory: (history: RouteHistoryState) => RouteHistoryState) {
    updateActiveTab((tab) => ({
      ...tab,
      history: updateHistory(tab.history),
    }));
  }

  function updateActiveTabAccount(accountId: string | null) {
    updateActiveTab((tab) => {
      if (tab.accountId === accountId) {
        return tab;
      }

      return {
        ...tab,
        accountId,
      };
    });
  }

  function navigateToRoute(route: AppRoute) {
    const defaultAccountId = getDefaultAccountId(accountsState);

    updateActiveTab((tab) => {
      const currentEntry = tab.history.entries[tab.history.index] ?? null;
      const accountId = accountExists(accountsState, tab.accountId) ? tab.accountId : defaultAccountId;
      const history =
        currentEntry?.displayUrl === route.displayUrl
          ? tab.history
          : {
              entries: [...tab.history.entries.slice(0, tab.history.index + 1), route],
              index: tab.history.index + 1,
            };

      if (history === tab.history && accountId === tab.accountId) {
        return tab;
      }

      return {
        ...tab,
        accountId,
        history,
      };
    });
  }

  function goBack() {
    updateActiveTabHistory((currentHistory) => ({
      ...currentHistory,
      index: Math.max(0, currentHistory.index - 1),
    }));
  }

  function goForward() {
    updateActiveTabHistory((currentHistory) => ({
      ...currentHistory,
      index: Math.min(currentHistory.entries.length - 1, currentHistory.index + 1),
    }));
  }

  function goHome() {
    updateActiveTabHistory(() => ({
      entries: [DASHBOARD_ROUTE],
      index: 0,
    }));
  }

  function goToHistoryIndex(index: number) {
    updateActiveTabHistory((currentHistory) => ({
      ...currentHistory,
      index: Math.max(0, Math.min(currentHistory.entries.length - 1, index)),
    }));
  }

  function openSettings() {
    navigateToRoute(SETTINGS_ROUTE);
  }

  function addClosedTabToHistory(currentClosedTabs: ClosedBrowserTab[], tab: BrowserTab) {
    return addClosedTabsToHistory(currentClosedTabs, [tab]);
  }

  function addClosedTabsToHistory(currentClosedTabs: ClosedBrowserTab[], tabs: BrowserTab[]) {
    const snapshots = tabs.map(createClosedTabSnapshot).reverse();

    return [
      ...snapshots,
      ...currentClosedTabs,
    ].slice(0, CLOSED_TAB_HISTORY_LIMIT);
  }

  function addTab() {
    const tab = createBrowserTab(getDefaultAccountId(accountsState));

    setTabState((currentTabState) => ({
      ...currentTabState,
      tabs: [...currentTabState.tabs, tab],
      activeTabId: tab.id,
    }));
  }

  function selectTab(tabId: string) {
    setTabState((currentTabState) => {
      if (!currentTabState.tabs.some((tab) => tab.id === tabId)) {
        return currentTabState;
      }

      return {
        ...currentTabState,
        activeTabId: tabId,
      };
    });
  }

  function selectTabByIndex(index: number) {
    setTabState((currentTabState) => {
      const tab = currentTabState.tabs[index];

      if (!tab) {
        return currentTabState;
      }

      return {
        ...currentTabState,
        activeTabId: tab.id,
      };
    });
  }

  function selectLastTab() {
    setTabState((currentTabState) => {
      const tab = currentTabState.tabs[currentTabState.tabs.length - 1];

      if (!tab) {
        return currentTabState;
      }

      return {
        ...currentTabState,
        activeTabId: tab.id,
      };
    });
  }

  function selectRelativeTab(direction: -1 | 1) {
    setTabState((currentTabState) => {
      const currentIndex = currentTabState.tabs.findIndex((tab) => tab.id === currentTabState.activeTabId);

      if (currentIndex === -1 || currentTabState.tabs.length < 2) {
        return currentTabState;
      }

      const nextIndex = (currentIndex + direction + currentTabState.tabs.length) % currentTabState.tabs.length;

      return {
        ...currentTabState,
        activeTabId: currentTabState.tabs[nextIndex].id,
      };
    });
  }

  function selectNextTab() {
    selectRelativeTab(1);
  }

  function selectPreviousTab() {
    selectRelativeTab(-1);
  }

  function removeTab(tabId: string, options: RemoveTabOptions) {
    setTabState((currentTabState) => {
      const closingTab = currentTabState.tabs.find((tab) => tab.id === tabId);

      if (!closingTab) {
        return currentTabState;
      }

      const closedTabs = options.addToClosedHistory
        ? addClosedTabToHistory(currentTabState.closedTabs, closingTab)
        : currentTabState.closedTabs;

      if (currentTabState.tabs.length <= 1) {
        const tab = createBrowserTab(getDefaultAccountId(accountsState));

        return {
          ...currentTabState,
          closedTabs,
          tabs: [tab],
          activeTabId: tab.id,
        };
      }

      const closingTabIndex = currentTabState.tabs.findIndex((tab) => tab.id === tabId);

      const tabs = currentTabState.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveIndex = Math.min(closingTabIndex, tabs.length - 1);

      return {
        ...currentTabState,
        closedTabs,
        tabs,
        activeTabId:
          currentTabState.activeTabId === tabId ? tabs[nextActiveIndex].id : currentTabState.activeTabId,
      };
    });
  }

  function closeTab(tabId: string) {
    removeTab(tabId, { addToClosedHistory: true });
  }

  function closeOtherTabs(tabId: string) {
    setTabState((currentTabState) => {
      const keepTab = currentTabState.tabs.find((tab) => tab.id === tabId);

      if (!keepTab || currentTabState.tabs.length <= 1) {
        return currentTabState;
      }

      const closingTabs = currentTabState.tabs.filter((tab) => tab.id !== tabId);
      const closedTabs = addClosedTabsToHistory(currentTabState.closedTabs, closingTabs);

      return {
        ...currentTabState,
        activeTabId: keepTab.id,
        closedTabs,
        tabs: [keepTab],
      };
    });
  }

  function closeTabsToRight(tabId: string) {
    setTabState((currentTabState) => {
      const tabIndex = currentTabState.tabs.findIndex((tab) => tab.id === tabId);

      if (tabIndex === -1 || tabIndex === currentTabState.tabs.length - 1) {
        return currentTabState;
      }

      const tabs = currentTabState.tabs.slice(0, tabIndex + 1);
      const closingTabs = currentTabState.tabs.slice(tabIndex + 1);
      const closedTabs = addClosedTabsToHistory(currentTabState.closedTabs, closingTabs);
      const activeTabExists = tabs.some((tab) => tab.id === currentTabState.activeTabId);

      return {
        ...currentTabState,
        activeTabId: activeTabExists ? currentTabState.activeTabId : currentTabState.tabs[tabIndex].id,
        closedTabs,
        tabs,
      };
    });
  }

  function closeActiveTab() {
    closeTab(tabState.activeTabId);
  }

  function reopenClosedTab() {
    setTabState((currentTabState) => {
      const [closedTab, ...closedTabs] = currentTabState.closedTabs;

      if (!closedTab) {
        return currentTabState;
      }

      const tab = createBrowserTabFromClosedTab(closedTab, accountsState);

      return {
        ...currentTabState,
        closedTabs,
        tabs: [...currentTabState.tabs, tab],
        activeTabId: tab.id,
      };
    });
  }

  function reloadActiveTab() {
    reloadTab(tabState.activeTabId);
  }

  function reloadTab(tabId: string) {
    setTabState((currentTabState) => ({
      ...currentTabState,
      tabs: currentTabState.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              reloadNonce: tab.reloadNonce + 1,
            }
          : tab,
      ),
    }));
  }

  function duplicateTab(tabId: string) {
    setTabState((currentTabState) => {
      const tabIndex = currentTabState.tabs.findIndex((tab) => tab.id === tabId);
      const sourceTab = currentTabState.tabs[tabIndex];

      if (!sourceTab) {
        return currentTabState;
      }

      const tab = createBrowserTab(sourceTab.accountId, sourceTab.history);

      return {
        ...currentTabState,
        activeTabId: tab.id,
        tabs: [
          ...currentTabState.tabs.slice(0, tabIndex + 1),
          tab,
          ...currentTabState.tabs.slice(tabIndex + 1),
        ],
      };
    });
  }

  async function moveTabToNewWindow(tabId: string) {
    const windowsApi = window.qortiumHome.windows;
    const tab = tabState.tabs.find((candidateTab) => candidateTab.id === tabId);

    if (!windowsApi || !tab) {
      return;
    }

    try {
      await windowsApi.openTabInNewWindow({
        tab: createWindowTabSnapshot(tab),
      });
      removeTab(tabId, { addToClosedHistory: false });
    } catch (error) {
      console.warn('Unable to move tab to a new window.', error);
    }
  }

  function openDashboardWindow() {
    void window.qortiumHome.windows?.openDashboardWindow();
  }

  function closeCurrentWindow() {
    void window.qortiumHome.windows?.closeCurrentWindow();
  }

  function focusAddressBar() {
    const addressInput = document.querySelector<HTMLInputElement>('#browser-address');

    addressInput?.focus();
    addressInput?.select();
  }

  function reorderTab(draggedTabId: string, targetTabId: string, dropPosition: TabDropPosition) {
    setTabState((currentTabState) => {
      if (draggedTabId === targetTabId) {
        return currentTabState;
      }

      const draggedTab = currentTabState.tabs.find((tab) => tab.id === draggedTabId);

      if (!draggedTab) {
        return currentTabState;
      }

      const tabsWithoutDraggedTab = currentTabState.tabs.filter((tab) => tab.id !== draggedTabId);
      const targetIndex = tabsWithoutDraggedTab.findIndex((tab) => tab.id === targetTabId);

      if (targetIndex === -1) {
        return currentTabState;
      }

      const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
      const tabs = [
        ...tabsWithoutDraggedTab.slice(0, insertIndex),
        draggedTab,
        ...tabsWithoutDraggedTab.slice(insertIndex),
      ];

      return {
        ...currentTabState,
        tabs,
      };
    });
  }

  tabCommandActionsRef.current = {
    addTab,
    canGoBack,
    canGoForward,
    closeActiveTab,
    closeCurrentWindow,
    focusAddressBar,
    goBack,
    goForward,
    openDashboardWindow,
    reloadActiveTab,
    reopenClosedTab,
    selectLastTab,
    selectNextTab,
    selectPreviousTab,
    selectTabByIndex,
  };

  navigationActionsRef.current = {
    canGoBack,
    canGoForward,
    currentRoute,
    goBack,
    goForward,
    goHome,
  };

  useEffect(() => {
    return window.qortiumHome.menu?.onCommand((command) => {
      const actions = tabCommandActionsRef.current;

      if (!actions) {
        return;
      }

      if (command === 'new-tab') {
        actions.addTab();
        return;
      }

      if (command === 'reopen-closed-tab') {
        actions.reopenClosedTab();
        return;
      }

      if (command === 'close-tab') {
        actions.closeActiveTab();
        return;
      }

      if (command === 'reload-tab') {
        actions.reloadActiveTab();
        return;
      }

      if (command === 'focus-address-bar') {
        actions.focusAddressBar();
        return;
      }

      if (command === 'go-back') {
        if (actions.canGoBack) {
          actions.goBack();
        }
        return;
      }

      if (command === 'go-forward' && actions.canGoForward) {
        actions.goForward();
      }
    });
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return undefined;
    }

    let isDisposed = false;
    let removeBackButtonListener: (() => Promise<void>) | undefined;

    void CapacitorApp.addListener('backButton', async () => {
      const actions = navigationActionsRef.current;

      if (!actions) {
        return;
      }

      if (actions.canGoBack) {
        actions.goBack();
        return;
      }

      if (actions.currentRoute.kind !== 'dashboard') {
        actions.goHome();
        return;
      }

      await CapacitorApp.minimizeApp();
    }).then((listener) => {
      if (isDisposed) {
        void listener.remove();
        return;
      }

      removeBackButtonListener = () => listener.remove();
    });

    return () => {
      isDisposed = true;

      if (removeBackButtonListener) {
        void removeBackButtonListener();
      }
    };
  }, []);

  useEffect(() => {
    function runCommand(event: KeyboardEvent, command: () => void | Promise<void>) {
      event.preventDefault();
      event.stopPropagation();
      void command();
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (!shouldUseKeyboardShortcut(event)) {
        return;
      }

      const actions = tabCommandActionsRef.current;

      if (!actions) {
        return;
      }

      const key = event.key.toLowerCase();
      const isEditableTarget = isEditableShortcutTarget(event.target);
      const isAddressBarTarget = isAddressBarShortcutTarget(event.target);
      const primaryModifier = isPrimaryShortcutModifier(event);
      const primaryOnly = primaryModifier && !event.altKey;
      const windowsApi = window.qortiumHome.windows;

      if (windowsApi && primaryOnly && !event.shiftKey && key === 'n') {
        runCommand(event, actions.openDashboardWindow);
        return;
      }

      if (windowsApi && primaryOnly && event.shiftKey && key === 'w') {
        runCommand(event, actions.closeCurrentWindow);
        return;
      }

      if (primaryOnly && event.shiftKey && key === 't') {
        runCommand(event, actions.reopenClosedTab);
        return;
      }

      if (primaryOnly && !event.shiftKey && key === 't') {
        runCommand(event, actions.addTab);
        return;
      }

      if (primaryOnly && !event.shiftKey && key === 'w') {
        runCommand(event, actions.closeActiveTab);
        return;
      }

      if (primaryOnly && !event.shiftKey && key === 'l') {
        runCommand(event, actions.focusAddressBar);
        return;
      }

      if (primaryOnly && key === 'r') {
        runCommand(event, actions.reloadActiveTab);
        return;
      }

      if (!event.altKey && event.ctrlKey && key === 'tab') {
        runCommand(event, event.shiftKey ? actions.selectPreviousTab : actions.selectNextTab);
        return;
      }

      if (primaryOnly && (key === 'pageup' || key === 'pagedown')) {
        runCommand(event, key === 'pageup' ? actions.selectPreviousTab : actions.selectNextTab);
        return;
      }

      if (primaryOnly && !event.shiftKey && /^[1-9]$/.test(key)) {
        runCommand(event, () => {
          if (key === '9') {
            actions.selectLastTab();
            return;
          }

          actions.selectTabByIndex(Number.parseInt(key, 10) - 1);
        });
        return;
      }

      if (key === 'f5') {
        runCommand(event, actions.reloadActiveTab);
        return;
      }

      if (isEditableTarget && !isAddressBarTarget) {
        return;
      }

      if (
        (event.altKey && !primaryModifier && key === 'arrowleft') ||
        (event.metaKey && !event.ctrlKey && !event.altKey && key === '[') ||
        key === 'browserback'
      ) {
        if (actions.canGoBack) {
          runCommand(event, actions.goBack);
        }
        return;
      }

      if (
        (event.altKey && !primaryModifier && key === 'arrowright') ||
        (event.metaKey && !event.ctrlKey && !event.altKey && key === ']') ||
        key === 'browserforward'
      ) {
        if (actions.canGoForward) {
          runCommand(event, actions.goForward);
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, []);

  const isNativeApp = Capacitor.isNativePlatform();
  const appMainClassName = [
    'app-main',
    isDashboardRoute ? 'app-main--dashboard' : '',
    isViewerRoute ? 'app-main--viewer' : '',
    isSettingsRoute ? 'app-main--settings' : '',
    isNativeApp ? 'app-main--gesture-nav' : '',
  ].filter(Boolean).join(' ');

  function clearNavigationSwipe(event?: ReactPointerEvent<HTMLElement>) {
    if (event && navigationSwipeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    navigationSwipeRef.current = null;
  }

  function handleMainPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      !isNativeApp ||
      event.pointerType === 'mouse' ||
      !event.isPrimary ||
      shouldIgnoreNavigationSwipe(event.target)
    ) {
      return;
    }

    navigationSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMainPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const swipeState = navigationSwipeRef.current;

    if (!swipeState || swipeState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - swipeState.startX;
    const deltaY = event.clientY - swipeState.startY;

    if (Math.abs(deltaY) > NAVIGATION_SWIPE_VERTICAL_CANCEL_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      clearNavigationSwipe(event);
    }
  }

  function handleMainPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const swipeState = navigationSwipeRef.current;

    if (!swipeState || swipeState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - swipeState.startX;
    const deltaY = event.clientY - swipeState.startY;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);
    const isNavigationSwipe =
      absoluteX >= NAVIGATION_SWIPE_MIN_DISTANCE_PX &&
      absoluteY <= NAVIGATION_SWIPE_MAX_VERTICAL_PX &&
      absoluteX >= absoluteY * NAVIGATION_SWIPE_HORIZONTAL_RATIO;
    const actions = navigationActionsRef.current;

    clearNavigationSwipe(event);

    if (!isNavigationSwipe || !actions) {
      return;
    }

    if (deltaX > 0 && actions.canGoBack) {
      actions.goBack();
      return;
    }

    if (deltaX < 0 && actions.canGoForward) {
      actions.goForward();
    }
  }

  if (!nodeSettings || isLoadingWindowStartupPayload) {
    return (
      <main className="app-shell">
        <section className="app-main" aria-label="Qortium Home">
          <div className="home-content">
            <h1>Qortium Home</h1>
            <p className={`app-message${nodeSettingsError ? ' app-message--error' : ''}`}>
              {nodeSettingsError || (isLoadingWindowStartupPayload ? 'Loading window' : 'Loading node settings')}
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <TopBar
        activeTabId={tabState.activeTabId}
        activeAccount={activeAccount}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canReopenClosedTab={tabState.closedTabs.length > 0}
        currentRoute={currentRoute}
        historyEntries={routeHistory.entries}
        historyIndex={routeHistory.index}
        tabs={tabState.tabs.map((tab) => ({
          id: tab.id,
          label: getTabLabel(tab),
        }))}
        onAddTab={addTab}
        onCloseTab={closeTab}
        onCloseOtherTabs={closeOtherTabs}
        onCloseTabsToRight={closeTabsToRight}
        onDuplicateTab={duplicateTab}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoToHistoryIndex={goToHistoryIndex}
        onMoveTabToNewWindow={window.qortiumHome.windows ? moveTabToNewWindow : undefined}
        onNavigate={navigateToRoute}
        onOpenSettings={openSettings}
        onReorderTab={reorderTab}
        onReloadTab={reloadTab}
        onReopenClosedTab={reopenClosedTab}
        onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
        onSelectTab={selectTab}
        nodeSettings={nodeSettings}
      />
      <section
        className={appMainClassName}
        aria-label={isDashboardRoute ? 'Dashboard' : isSettingsRoute ? 'Settings' : 'Browser page'}
        onPointerCancel={clearNavigationSwipe}
        onPointerDown={handleMainPointerDown}
        onPointerMove={handleMainPointerMove}
        onPointerUp={handleMainPointerUp}
      >
        {currentRoute.kind === 'node-api' ? (
          <ApiViewer key={routeRenderKey} route={currentRoute} />
        ) : currentRoute.kind === 'resource' ? (
          <QdnViewer
            key={routeRenderKey}
            nodeApiUrl={nodeSettings.nodeApiUrl}
            resource={currentRoute.resource}
            accountId={activeTab.accountId}
            suspended={isQdnPermissionDialogActive}
            tabId={activeTab.id}
          />
        ) : currentRoute.kind === 'settings' ? (
          <SettingsPage
            appUpdates={appUpdates}
            coreManager={coreManager}
            nodeSettings={nodeSettings}
            onChainCoreUpdate={onChainCoreUpdate}
            onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
            onSectionExpansionChange={updateSettingsSectionExpansion}
            onSaveNodeSettings={saveNodeSettings}
            sectionExpansion={settingsExpansion}
          />
        ) : currentRoute.kind === 'dashboard' ? (
          <DashboardPage
            accountsError={accountsError}
            accountsState={accountsState}
            appUpdates={appUpdates}
            coreManager={coreManager}
            isLoadingAccounts={isLoadingAccounts}
            onChainCoreUpdate={onChainCoreUpdate}
            selectedAccountId={activeTab.accountId}
            onAccountsStateChange={handleAccountsStateChange}
            onSelectedAccountChange={updateActiveTabAccount}
          />
        ) : (
          <QdnExplorer
            key={routeRenderKey}
            nodeApiUrl={nodeSettings.nodeApiUrl}
            route={currentRoute}
            onNavigate={navigateToRoute}
          />
        )}
      </section>
      {activeQdnAccountReadRequest ? (
        <QdnAccountReadDialog
          request={activeQdnAccountReadRequest}
          onResolve={resolveQdnAccountReadRequest}
        />
      ) : null}
      {activeQdnWriteRequest ? (
        <QdnWriteDialog
          request={activeQdnWriteRequest}
          onResolve={resolveQdnWriteRequest}
        />
      ) : null}
    </main>
  );
}
