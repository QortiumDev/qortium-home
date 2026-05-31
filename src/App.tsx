import './styles.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AccountsPanel } from './AccountsPanel';
import { ApiViewer } from './ApiViewer';
import { QdnExplorer } from './QdnExplorer';
import { QdnViewer } from './QdnViewer';
import { SettingsPage } from './SettingsPage';
import { TopBar } from './TopBar';
import { SETTINGS_ROUTE, type AppRoute } from './routes';

type RouteHistoryState = {
  entries: (AppRoute | null)[];
  index: number;
};

type BrowserTab = {
  accountId: string | null;
  history: RouteHistoryState;
  id: string;
};

type BrowserTabState = {
  activeTabId: string;
  tabs: BrowserTab[];
};

type TabDropPosition = 'after' | 'before';

type NavigationActions = {
  canGoBack: boolean;
  canGoForward: boolean;
  currentRoute: AppRoute | null;
  goBack: () => void;
  goForward: () => void;
  goHome: () => void;
};

type NavigationSwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
};

let nextTabId = 1;

const EMPTY_ACCOUNTS_STATE: QortiumAccountsState = {
  accounts: [],
  activeAccountId: null,
};
const NAVIGATION_SWIPE_MIN_DISTANCE_PX = 72;
const NAVIGATION_SWIPE_MAX_VERTICAL_PX = 80;
const NAVIGATION_SWIPE_HORIZONTAL_RATIO = 1.6;
const NAVIGATION_SWIPE_VERTICAL_CANCEL_PX = 48;

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

function createBrowserTab(accountId: string | null = null): BrowserTab {
  const id = `tab-${nextTabId}`;

  nextTabId += 1;

  return {
    accountId,
    id,
    history: {
      entries: [null],
      index: 0,
    },
  };
}

function createInitialTabState(): BrowserTabState {
  const tab = createBrowserTab();

  return {
    activeTabId: tab.id,
    tabs: [tab],
  };
}

function getTabLabel(tab: BrowserTab) {
  return tab.history.entries[tab.history.index]?.displayUrl ?? 'Qortium Home';
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

export function App() {
  const [accountsState, setAccountsState] = useState<QortiumAccountsState>(EMPTY_ACCOUNTS_STATE);
  const [accountsError, setAccountsError] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [nodeSettings, setNodeSettings] = useState<QortiumNodeSettings | null>(null);
  const [nodeSettingsError, setNodeSettingsError] = useState('');
  const [tabState, setTabState] = useState<BrowserTabState>(createInitialTabState);
  const navigationActionsRef = useRef<NavigationActions | null>(null);
  const navigationSwipeRef = useRef<NavigationSwipeState | null>(null);
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? tabState.tabs[0];
  const activeAccount =
    accountsState.accounts.find((account) => account.id === activeTab.accountId) ?? null;
  const routeHistory = activeTab.history;
  const currentRoute = routeHistory.entries[routeHistory.index] ?? null;
  const isSettingsRoute = currentRoute?.kind === 'settings';
  const isViewerRoute = currentRoute !== null && !isSettingsRoute;
  const canGoBack = routeHistory.index > 0;
  const canGoForward = routeHistory.index < routeHistory.entries.length - 1;

  function reconcileTabsWithAccounts(nextAccountsState: QortiumAccountsState) {
    setTabState((currentTabState) => {
      const defaultAccountId = getDefaultAccountId(nextAccountsState);
      const tabs = currentTabState.tabs.map((tab) => {
        if (accountExists(nextAccountsState, tab.accountId)) {
          return tab;
        }

        const currentRoute = tab.history.entries[tab.history.index] ?? null;
        const nextAccountId = tab.accountId && currentRoute ? null : defaultAccountId;

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
      entries: [null],
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

  function addTab() {
    const tab = createBrowserTab(getDefaultAccountId(accountsState));

    setTabState((currentTabState) => ({
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

  function closeTab(tabId: string) {
    setTabState((currentTabState) => {
      if (currentTabState.tabs.length <= 1) {
        const tab = createBrowserTab(getDefaultAccountId(accountsState));

        return {
          tabs: [tab],
          activeTabId: tab.id,
        };
      }

      const closingTabIndex = currentTabState.tabs.findIndex((tab) => tab.id === tabId);

      if (closingTabIndex === -1) {
        return currentTabState;
      }

      const tabs = currentTabState.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveIndex = Math.min(closingTabIndex, tabs.length - 1);

      return {
        tabs,
        activeTabId:
          currentTabState.activeTabId === tabId ? tabs[nextActiveIndex].id : currentTabState.activeTabId,
      };
    });
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

  navigationActionsRef.current = {
    canGoBack,
    canGoForward,
    currentRoute,
    goBack,
    goForward,
    goHome,
  };

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

      if (actions.currentRoute) {
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

  const isNativeApp = Capacitor.isNativePlatform();
  const appMainClassName = [
    'app-main',
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

  if (!nodeSettings) {
    return (
      <main className="app-shell">
        <section className="app-main" aria-label="Qortium Home">
          <div className="home-content">
            <h1>Qortium Home</h1>
            <p className={`app-message${nodeSettingsError ? ' app-message--error' : ''}`}>
              {nodeSettingsError || 'Loading node settings'}
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
        currentRoute={currentRoute}
        historyEntries={routeHistory.entries}
        historyIndex={routeHistory.index}
        tabs={tabState.tabs.map((tab) => ({
          id: tab.id,
          label: getTabLabel(tab),
        }))}
        onAddTab={addTab}
        onCloseTab={closeTab}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoToHistoryIndex={goToHistoryIndex}
        onNavigate={navigateToRoute}
        onOpenSettings={openSettings}
        onReorderTab={reorderTab}
        onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
        onSelectTab={selectTab}
        nodeSettings={nodeSettings}
      />
      <section
        className={appMainClassName}
        aria-label={isSettingsRoute ? 'Settings' : isViewerRoute ? 'Browser page' : 'Qortium Home'}
        onPointerCancel={clearNavigationSwipe}
        onPointerDown={handleMainPointerDown}
        onPointerMove={handleMainPointerMove}
        onPointerUp={handleMainPointerUp}
      >
        {currentRoute?.kind === 'node-api' ? (
          <ApiViewer route={currentRoute} />
        ) : currentRoute?.kind === 'resource' ? (
          <QdnViewer nodeApiUrl={nodeSettings.nodeApiUrl} resource={currentRoute.resource} />
        ) : currentRoute?.kind === 'settings' ? (
          <SettingsPage
            nodeSettings={nodeSettings}
            onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
            onSaveNodeSettings={saveNodeSettings}
          />
        ) : currentRoute ? (
          <QdnExplorer nodeApiUrl={nodeSettings.nodeApiUrl} route={currentRoute} onNavigate={navigateToRoute} />
        ) : (
          <div className="home-content">
            <h1>Qortium Home</h1>
            <AccountsPanel
              accountsError={accountsError}
              accountsState={accountsState}
              isLoadingAccounts={isLoadingAccounts}
              selectedAccountId={activeTab.accountId}
              onAccountsStateChange={handleAccountsStateChange}
              onSelectedAccountChange={updateActiveTabAccount}
            />
          </div>
        )}
      </section>
    </main>
  );
}
