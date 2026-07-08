import './styles.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ApiViewer } from './ApiViewer';
import { getSavedAccountContext } from './accountContext';
import { useAppUpdates } from './appUpdateState';
import {
  addBookmark,
  addBookmarkFolder,
  findBookmarkItem,
  flattenBookmarkItems,
  hasBookmarkedUrl,
  loadBookmarksState,
  moveBookmarkItem,
  removeBookmark,
  saveBookmarksState,
  setBookmarkToolbarVisible,
  updateBookmark,
  updateBookmarkFolder,
  type BookmarkFolderId,
  type BookmarkFolderRequest,
  type BookmarkMoveRequest,
  type BookmarkRootId,
  type BookmarkRootMoveRequest,
  type BookmarkUpdateRequest,
  type BookmarksState,
} from './bookmarks';
import { BookmarksPage } from './BookmarksPage';
import { CoreApiDocsPage } from './CoreApiDocsPage';
import { useCoreManager } from './coreManagerState';
import { DashboardPage } from './DashboardPage';
import {
  applyDisplaySettings,
  clampAppZoom,
  DEFAULT_TEXT_SIZE,
  getInitialDisplaySettings,
  getSystemLanguage,
  getSystemTheme,
  loadDisplaySettings,
  nextTextSize,
  prevTextSize,
  resolveDisplaySettings,
  saveDisplaySettings,
  stepAppZoom,
  subscribeToSystemLanguageChange,
  subscribeToSystemThemeChange,
  type DisplaySettings,
} from './displaySettings';
import {
  createDashboardPin,
  loadDashboardPins,
  removeDashboardPin,
  reorderDashboardPins,
  saveDashboardPins,
  setDashboardPinLabel,
  updateDashboardPin,
  upsertDashboardPin,
  type DashboardPin,
  type DashboardPinDropPosition,
} from './dashboardPins';
import {
  addStartPage,
  loadStartPages,
  MAX_START_PAGES,
  removeStartPage,
  saveStartPages,
  updateStartPage,
  type StartPage,
} from './startPages';
import { useOnChainCoreUpdate } from './onChainCoreUpdateState';
import { ModalDialog } from './components/ModalDialog';
import { setTranslationLanguage, subscribeTranslationChange, t, type TranslationKey } from './i18n';
import { invalidateDesktopNodeSettingsCache } from './platform';
import {
  buildQdnDisplayUrl,
  getQdnViewerKind,
  type QdnDisplaySettings,
  type QdnResource,
  type QdnService,
} from './qdn';
import { QdnExplorer } from './QdnExplorer';
import { QdnPreviewViewer } from './QdnPreview';
import { DocumentViewer } from './DocumentViewer';
import { QdnViewer } from './QdnViewer';
import { ReleaseNotesPage } from './ReleaseNotesPage';
import { SettingsPage, type SettingsExpansionState, type SettingsSectionId } from './SettingsPage';
import { TopBar } from './TopBar';
import { BOOKMARKS_ROUTE, DASHBOARD_ROUTE, SETTINGS_ROUTE, buildReleaseNotesRoute, parseAppAddress, type AppRoute } from './routes';

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

type QdnWriteDialogProps = {
  request: QortiumQdnWriteApprovalRequest;
  onResolve: (requestId: string, approved: boolean) => void;
};

type QdnUnlockDialogProps = {
  request: QortiumQdnUnlockRequest;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
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
  display: true,
  home: false,
  node: false,
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

function getSavedPageAccountId(displayUrl: string, accountId: string | null | undefined) {
  return getSavedAccountContext(displayUrl, accountId);
}

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('account.actionFailed');
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

function getQdnWriteActionKey(action: QortiumQdnWriteApprovalRequest['action']): TranslationKey {
  switch (action) {
    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return 'qdnWrite.action.publishResources';
    case 'PUBLISH_QDN_RESOURCE':
      return 'qdnWrite.action.publishResource';
    case 'DELETE_QDN_RESOURCE':
      return 'qdnWrite.action.deleteResource';
    case 'APPROVE_GROUP_JOIN_REQUEST':
      return 'qdnWrite.action.approveGroupJoinRequest';
    case 'GROUP_APPROVAL':
      return 'qdnWrite.action.groupApproval';
    case 'INVITE_TO_GROUP':
      return 'qdnWrite.action.inviteToGroup';
    case 'JOIN_GROUP':
      return 'qdnWrite.action.joinGroup';
    case 'LEAVE_GROUP':
      return 'qdnWrite.action.leaveGroup';
    case 'UPDATE_GROUP':
      return 'qdnWrite.action.updateGroup';
    case 'CREATE_GROUP':
      return 'qdnWrite.action.createGroup';
    case 'ADD_GROUP_ADMIN':
      return 'qdnWrite.action.addGroupAdmin';
    case 'REMOVE_GROUP_ADMIN':
      return 'qdnWrite.action.removeGroupAdmin';
    case 'GROUP_BAN':
      return 'qdnWrite.action.groupBan';
    case 'CANCEL_GROUP_BAN':
      return 'qdnWrite.action.cancelGroupBan';
    case 'GROUP_KICK':
      return 'qdnWrite.action.groupKick';
    case 'CANCEL_GROUP_INVITE':
      return 'qdnWrite.action.cancelGroupInvite';
    case 'SET_GROUP':
      return 'qdnWrite.action.setGroup';
    case 'SET_CURRENT_FOREIGN_SERVER':
      return 'qdnWrite.action.setCurrentForeignServer';
    case 'SEND_QORTAL_GROUP_CHAT':
      return 'qdnWrite.action.sendChatMessage';
    case 'SEND_QORT':
      return 'qdnWrite.action.sendCoin';
    case 'PAYMENT':
    case 'SEND_COIN':
      return 'qdnWrite.action.sendCoin';
    case 'TRANSFER_ASSET':
      return 'qdnWrite.action.transferAsset';
    case 'CREATE_POLL':
      return 'qdnWrite.action.createPoll';
    case 'VOTE_ON_POLL':
      return 'qdnWrite.action.voteOnPoll';
    case 'UPDATE_POLL':
      return 'qdnWrite.action.updatePoll';
    case 'RATE_ACCOUNT':
      return 'qdnWrite.action.rateAccount';
    case 'RATE_RESOURCE':
      return 'qdnWrite.action.rateResource';
    case 'BUY_NAME':
      return 'qdnWrite.action.buyName';
    case 'CANCEL_SELL_NAME':
      return 'qdnWrite.action.cancelNameSale';
    case 'REGISTER_NAME':
      return 'qdnWrite.action.registerName';
    case 'SELL_NAME':
      return 'qdnWrite.action.sellName';
    case 'UPDATE_NAME':
      return 'qdnWrite.action.updateName';
    case 'SEND_CHAT_MESSAGE':
      return 'qdnWrite.action.sendChatMessage';
    case 'REQUEST_PRIVATE_GROUP_CHAT_KEY':
      return 'qdnWrite.action.requestPrivateGroupChatKey';
    case 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS':
      return 'qdnWrite.action.resolvePrivateGroupChatKeyRequests';
    case 'START_MINTING':
      return 'qdnWrite.action.startMinting';
    case 'REMOVE_MINTING_ACCOUNT':
      return 'qdnWrite.action.removeMintingAccount';
    default:
      return 'qdnWrite.action.default';
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

function getQdnWriteSourceKey(sourceKind: QortiumQdnWriteApprovalRequest['sourceKind']): TranslationKey {
  switch (sourceKind) {
    case 'data':
      return 'qdnWrite.source.data';
    case 'directory':
      return 'qdnWrite.source.folder';
    default:
      return 'qdnWrite.source.file';
  }
}

function QdnUnlockDialog({ request, onAccountsStateChange, onResolve }: QdnUnlockDialogProps) {
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  function dismiss() {
    if (!isUnlocking) {
      onResolve(request.id, false);
    }
  }

  async function handleSubmit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isUnlocking) {
      return;
    }

    if (!password) {
      setUnlockError(t('account.enterWalletPassword'));
      return;
    }

    setUnlockError('');
    setIsUnlocking(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.unlockWallet(request.accountId, password);
      onAccountsStateChange(nextAccountsState);
      setPassword('');
      onResolve(request.id, true);
    } catch (error) {
      setUnlockError(formatError(error));
      setIsUnlocking(false);
    }
  }

  return (
    <ModalDialog onDismiss={dismiss}>
      <form
        aria-label={t('account.unlockAccountTitle')}
        aria-modal="true"
        className="unlock-dialog qdn-permission-dialog"
        role="dialog"
        onSubmit={handleSubmit}
      >
        <h2 className="unlock-dialog__title">{t('account.unlockAccountTitle')}</h2>
        <p className="unlock-dialog__account">
          {request.accountName || request.accountLabel || t('qdnWrite.selectedAccountFallback')}
        </p>
        <p className="unlock-dialog__address">{request.address}</p>
        <p className="qdn-permission-dialog__resource">{request.resourceUrl}</p>
        <label className="field">
          <span className="field__label">{t('common.password')}</span>
          <input
            autoFocus
            className="field__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {unlockError ? (
          <p className="accounts-panel__message accounts-panel__message--error">{unlockError}</p>
        ) : null}
        <div className="unlock-dialog__actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={isUnlocking}
            onClick={dismiss}
          >
            {t('common.cancel')}
          </button>
          <button className="button button--primary" type="submit" disabled={isUnlocking}>
            {isUnlocking ? t('common.unlocking') : t('common.unlock')}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

function QdnWriteDialog({ request, onResolve }: QdnWriteDialogProps) {
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const approveButtonRef = useRef<HTMLButtonElement>(null);

  // Keyboard model for this approval dialog: ModalDialog focuses the first action
  // (Deny) by default and handles Escape (deny) + Tab cycling. We deliberately do
  // NOT auto-focus Approve, so Enter never approves by accident — the focus ring on
  // Deny makes that obvious. Arrow keys move between the two actions (Left/Up to
  // Deny, Right/Down to Approve) so Approve is still quick to reach, after which
  // Enter/Space approves.
  function handleActionsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      approveButtonRef.current?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      denyButtonRef.current?.focus();
    }
  }

  return (
    <ModalDialog onDismiss={() => onResolve(request.id, false)}>
      <section
        aria-label={t('qdnWrite.dialogLabel')}
        aria-modal="true"
        className="unlock-dialog qdn-permission-dialog"
        role="dialog"
      >
        <h2 className="unlock-dialog__title">{t('qdnWrite.title')}</h2>
        <p className="unlock-dialog__account">{request.accountName || t('qdnWrite.selectedAccountFallback')}</p>
        <p className="unlock-dialog__address">{request.address}</p>
        <p className="qdn-permission-dialog__resource">{request.resourceUrl}</p>
        <dl className="detail-list qdn-permission-dialog__details">
          <div>
            <dt>{t('qdnWrite.field.action')}</dt>
            <dd>{t(getQdnWriteActionKey(request.action))}</dd>
          </div>
          {request.resource ? (
            <div>
              <dt>{t('qdnWrite.field.resource')}</dt>
              <dd>{getQdnWriteResourceLabel(request.resource)}</dd>
            </div>
          ) : null}
          {typeof request.resourceCount === 'number' ? (
            <div>
              <dt>{t('qdnWrite.field.resources')}</dt>
              <dd>{request.resourceCount}</dd>
            </div>
          ) : null}
          {request.name ? (
            <div>
              <dt>{t('common.name')}</dt>
              <dd>{request.name}</dd>
            </div>
          ) : null}
          {typeof request.groupId === 'number' ? (
            <div>
              <dt>{t('qdnWrite.field.group')}</dt>
              <dd>{getQdnWriteGroupLabel(request)}</dd>
            </div>
          ) : null}
          {typeof request.approval === 'boolean' ? (
            <div>
              <dt>{t('qdnWrite.voteDirection')}</dt>
              <dd>{t(request.approval ? 'qdnWrite.voteApprove' : 'qdnWrite.voteOppose')}</dd>
            </div>
          ) : null}
          {request.recipientAddress ? (
            <div>
              <dt>{t('qdnWrite.field.recipient')}</dt>
              <dd>{request.recipientAddress}</dd>
            </div>
          ) : null}
          {request.amount ? (
            <div>
              <dt>{t('qdnWrite.field.amount')}</dt>
              <dd>{request.amount}</dd>
            </div>
          ) : null}
          {(request.details ?? []).map((detail) => (
            <div key={`${detail.label}:${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
          {request.chatMessagePreview ? (
            <div>
              <dt>{t('qdnWrite.field.message')}</dt>
              <dd>{request.chatMessagePreview}</dd>
            </div>
          ) : null}
          {request.mintingKey ? (
            <div>
              <dt>{t('qdnWrite.field.mintingKey')}</dt>
              <dd>{request.mintingKey}</dd>
            </div>
          ) : null}
          {request.permissionScope === 'session' ? (
            <div>
              <dt>{t('qdnWrite.field.scope')}</dt>
              <dd>{t('qdnWrite.scopeSession')}</dd>
            </div>
          ) : null}
          {request.sourceName ? (
            <div>
              <dt>{t(getQdnWriteSourceKey(request.sourceKind))}</dt>
              <dd>{request.sourceName}</dd>
            </div>
          ) : null}
        </dl>
        <div className="unlock-dialog__actions" onKeyDown={handleActionsKeyDown}>
          <button
            ref={denyButtonRef}
            className="button button--secondary"
            type="button"
            onClick={() => onResolve(request.id, false)}
          >
            {t('qdnWrite.deny')}
          </button>
          <button
            ref={approveButtonRef}
            className="button button--primary"
            type="button"
            onClick={() => onResolve(request.id, true)}
          >
            {t('qdnWrite.approve')}
          </button>
        </div>
      </section>
    </ModalDialog>
  );
}

const QDN_MEDIA_PLAYER_SERVICES: readonly QdnService[] = ['AUDIO', 'PODCAST', 'VIDEO', 'VOICE'];

type QdnMediaPlayerDialogProps = {
  displaySettings: QdnDisplaySettings;
  nodeApiUrl: string;
  onDismiss: () => void;
  resource: QdnResource;
};

function QdnMediaPlayerDialog({ displaySettings, nodeApiUrl, onDismiss, resource }: QdnMediaPlayerDialogProps) {
  return (
    <ModalDialog onDismiss={onDismiss}>
      <section
        aria-label={t('mediaPlayer.dialogLabel')}
        aria-modal="true"
        className="media-player-dialog"
        role="dialog"
      >
        <header className="media-player-dialog__header">
          <span className="media-player-dialog__url">{resource.displayUrl}</span>
          <button
            aria-label={t('mediaPlayer.close')}
            className="icon-button media-player-dialog__close"
            type="button"
            onClick={onDismiss}
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </header>
        <div className="media-player-dialog__body">
          <QdnViewer
            key={resource.displayUrl}
            account={null}
            displaySettings={displaySettings}
            nodeApiUrl={nodeApiUrl}
            resource={resource}
            tabId={`media-player:${resource.displayUrl}`}
          />
        </div>
      </section>
    </ModalDialog>
  );
}

type QdnDocumentViewerDialogProps = {
  displaySettings: QdnDisplaySettings;
  onDismiss: () => void;
  resource: QdnResource;
};

function QdnDocumentViewerDialog({ displaySettings, onDismiss, resource }: QdnDocumentViewerDialogProps) {
  return (
    <ModalDialog onDismiss={onDismiss}>
      <DocumentViewer
        key={resource.displayUrl}
        displaySettings={displaySettings}
        onDismiss={onDismiss}
        resource={resource}
      />
    </ModalDialog>
  );
}

function getTabLabel(tab: BrowserTab) {
  const route = tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;

  if (route.kind === 'dashboard') {
    return t('common.dashboard');
  }

  if (route.kind === 'settings') {
    return t('common.settings');
  }

  if (route.kind === 'bookmarks') {
    return t('bookmarks.manageTitle');
  }

  if (route.kind === 'release-notes') {
    return `Release notes ${route.tagName}`;
  }

  if (route.kind === 'core-api-docs') {
    return t('explorer.coreApi');
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
  // Incremented when configured-node reachability changes, so node-derived data
  // loaded under the previous state gets refreshed.
  const [nodeEpoch, setNodeEpoch] = useState(0);
  const [connectionRefreshEpoch, setConnectionRefreshEpoch] = useState(0);
  const [qdnUnlockRequests, setQdnUnlockRequests] = useState<QortiumQdnUnlockRequest[]>([]);
  const [qdnWriteRequests, setQdnWriteRequests] = useState<QortiumQdnWriteApprovalRequest[]>([]);
  const [qdnMediaPlayerResource, setQdnMediaPlayerResource] = useState<QdnResource | null>(null);
  const [qdnDocumentViewerResource, setQdnDocumentViewerResource] = useState<QdnResource | null>(null);
  const [tabState, setTabState] = useState<BrowserTabState>(createInitialTabState);
  const [dashboardPins, setDashboardPins] = useState<DashboardPin[]>([]);
  const [bookmarksState, setBookmarksState] = useState<BookmarksState>({
    bookmarks: [],
    toolbar: [],
    toolbarVisible: false,
    version: 2,
  });
  const [settingsExpansion, setSettingsExpansion] = useState<SettingsExpansionState>(INITIAL_SETTINGS_EXPANSION);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(getInitialDisplaySettings);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [systemLanguage, setSystemLanguage] = useState(getSystemLanguage);
  const [isLoadingWindowStartupPayload, setIsLoadingWindowStartupPayload] = useState(true);
  const [startPages, setStartPages] = useState<StartPage[]>([]);
  const [isLoadingStartPages, setIsLoadingStartPages] = useState(true);
  const startPagesAppliedRef = useRef(false);
  const [isTopBarOverlayOpen, setIsTopBarOverlayOpen] = useState(false);
  const tabCommandActionsRef = useRef<TabCommandActions | null>(null);
  const navigationActionsRef = useRef<NavigationActions | null>(null);
  const dashboardPinsRef = useRef<DashboardPin[]>([]);
  const openAppLinkInNewTabRef = useRef<
    ((address: string, sourceTabId: string | null) => void) | null
  >(null);
  const openInCurrentTabRef = useRef<
    ((address: string, sourceTabId: string | null) => void) | null
  >(null);
  const openQdnMediaPlayerRef = useRef<((request: QortiumQdnMediaPlayerRequest) => void) | null>(null);
  const textSizeControlRef = useRef<{
    current: DisplaySettings['textSize'];
    update: (nextTextSize: DisplaySettings['textSize']) => void;
  } | null>(null);
  const appZoomControlRef = useRef<{
    current: number;
    update: (nextAppZoom: number) => void;
  } | null>(null);
  const openQdnDocumentViewerRef = useRef<((request: QortiumQdnDocumentViewerRequest) => void) | null>(null);
  const navigationSwipeRef = useRef<NavigationSwipeState | null>(null);
  const didRunInitialRouteRefreshRef = useRef(false);
  const lastRouteRefreshKeyRef = useRef<string | null>(null);
  const qdnViewRouteKeysRef = useRef<Map<string, string>>(new Map());
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? tabState.tabs[0];
  const activeAccount =
    accountsState.accounts.find((account) => account.id === activeTab.accountId) ?? null;
  const routeHistory = activeTab.history;
  const currentRoute = routeHistory.entries[routeHistory.index] ?? DASHBOARD_ROUTE;
  const isDashboardRoute = currentRoute.kind === 'dashboard';
  const isSettingsRoute = currentRoute.kind === 'settings';
  const isBookmarksRoute = currentRoute.kind === 'bookmarks';
  const isReleaseNotesRoute = currentRoute.kind === 'release-notes';
  const routeRefreshKey = isDashboardRoute || isSettingsRoute || isBookmarksRoute || isReleaseNotesRoute
    ? `${tabState.activeTabId}:${routeHistory.index}:${currentRoute.kind}`
    : null;
  const isExplorerRoute =
    currentRoute.kind === 'services' ||
    currentRoute.kind === 'service' ||
    currentRoute.kind === 'name' ||
    currentRoute.kind === 'name-services';
  const isViewerRoute = !isDashboardRoute && !isSettingsRoute && !isBookmarksRoute && !isReleaseNotesRoute && !isExplorerRoute;
  const isCurrentPageStartPage = startPages.some((page) => page.displayUrl === currentRoute.displayUrl);
  const isCurrentPageBookmarked = hasBookmarkedUrl(bookmarksState, currentRoute.displayUrl);
  const canAddCurrentStartPage = isCurrentPageStartPage || startPages.length < MAX_START_PAGES;
  const canGoBack = routeHistory.index > 0;
  const canGoForward = routeHistory.index < routeHistory.entries.length - 1;
  const activeQdnUnlockRequest = qdnUnlockRequests[0] ?? null;
  const activeQdnWriteRequest = qdnWriteRequests[0] ?? null;
  const isQdnPermissionDialogActive = !!activeQdnUnlockRequest || !!activeQdnWriteRequest;
  const isQdnViewSuspended = isQdnPermissionDialogActive || isTopBarOverlayOpen || !!qdnMediaPlayerResource || !!qdnDocumentViewerResource;
  const effectiveDisplaySettings = useMemo(
    () => resolveDisplaySettings(displaySettings, systemTheme, systemLanguage),
    [displaySettings, systemLanguage, systemTheme],
  );

  // t() reads module state, so the active language must be set before children render;
  // the layout effect that applies document-level settings runs too late for that.
  setTranslationLanguage(effectiveDisplaySettings.language);

  // Locales other than English load lazily, so re-render once the active language's
  // catalog finishes loading to swap the English fallback for the real strings.
  const [, bumpLocaleVersion] = useState(0);
  useEffect(() => subscribeTranslationChange(() => bumpLocaleVersion((version) => version + 1)), []);

  useEffect(() => {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    if (!qdnPermissions?.onUnlockRequest) {
      return undefined;
    }

    return qdnPermissions.onUnlockRequest((request) => {
      setQdnUnlockRequests((currentRequests) => {
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

  function resolveQdnUnlockRequest(requestId: string, approved: boolean) {
    const qdnPermissions = window.qortiumHome.qdnPermissions;

    setQdnUnlockRequests((currentRequests) =>
      currentRequests.filter((request) => request.id !== requestId),
    );

    const resolveRequest = qdnPermissions?.resolveUnlockRequest ?? qdnPermissions?.resolveWriteRequest;

    if (!resolveRequest) {
      return;
    }

    void resolveRequest(requestId, approved).catch((error) => {
      console.warn('Unable to resolve QDN unlock request.', error);
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

  useEffect(() => {
    if (isLoadingWindowStartupPayload || isLoadingStartPages || isLoadingAccounts) return;
    if (startPagesAppliedRef.current) return;

    startPagesAppliedRef.current = true;

    if (startPages.length === 0) return;

    setTabState((currentTabState) => {
      const activeTab = currentTabState.tabs.find((tab) => tab.id === currentTabState.activeTabId);
      const currentRoute = activeTab?.history.entries[activeTab.history.index];

      if (!currentRoute || currentRoute.kind !== 'dashboard') return currentTabState;

      const currentAccountId = accountExists(accountsState, activeTab.accountId) ? activeTab.accountId : null;
      const newTabs = startPages
        .map((page) => {
          const parsed = parseAppAddress(page.displayUrl);
          if (!parsed.success) return null;
          const accountId = page.accountId === null
            ? currentAccountId
            : accountExists(accountsState, page.accountId)
              ? page.accountId
              : currentAccountId;

          return createBrowserTab(accountId, { entries: [parsed.route], index: 0 });
        })
        .filter((tab): tab is BrowserTab => tab !== null);

      if (newTabs.length === 0) return currentTabState;

      return {
        activeTabId: newTabs[0].id,
        closedTabs: [],
        tabs: newTabs,
      };
    });
  }, [accountsState, isLoadingAccounts, isLoadingWindowStartupPayload, isLoadingStartPages, startPages]);

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
          setNodeSettingsError(error instanceof Error ? error.message : t('node.loadSettingsFailed'));
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

    loadDisplaySettings()
      .then((storedDisplaySettings) => {
        if (!isDisposed) {
          setDisplaySettings(storedDisplaySettings);
        }
      })
      .catch((error) => {
        console.warn('Unable to load display settings.', error);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    loadDashboardPins()
      .then((storedPins) => {
        if (!isDisposed) {
          dashboardPinsRef.current = storedPins;
          setDashboardPins(storedPins);
        }
      })
      .catch((error) => {
        console.warn('Unable to load dashboard pins.', error);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    loadStartPages()
      .then((pages) => {
        if (!isDisposed) {
          setStartPages(pages);
          setIsLoadingStartPages(false);
        }
      })
      .catch((error) => {
        console.warn('Unable to load start pages.', error);
        if (!isDisposed) {
          setIsLoadingStartPages(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    loadBookmarksState()
      .then((state) => {
        if (!isDisposed) {
          setBookmarksState(state);
        }
      })
      .catch((error) => {
        console.warn('Unable to load bookmarks.', error);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => subscribeToSystemThemeChange(setSystemTheme), []);

  useEffect(() => subscribeToSystemLanguageChange(setSystemLanguage), []);

  useLayoutEffect(() => {
    applyDisplaySettings(displaySettings, systemTheme, systemLanguage);
  }, [displaySettings, systemLanguage, systemTheme]);

  useEffect(() => {
    const zoomApi = window.qortiumHome.zoom;

    if (!zoomApi) {
      return;
    }

    const requested = effectiveDisplaySettings.appZoom;

    // Main returns the percent it actually applied (it clamps to its own zoom
    // level bounds) and deliberately does not echo a zoom:changed for this
    // call, so pushing settings to main can never loop back on itself. If the
    // applied value differs (e.g. a stored 200% clamps to 173% on desktop),
    // adopt it — unless the user has already stepped again in the meantime.
    zoomApi
      .set(requested)
      .then((applied) => {
        const appZoomControl = appZoomControlRef.current;

        if (applied !== requested && appZoomControl && appZoomControl.current === requested) {
          appZoomControl.current = applied;
          appZoomControl.update(applied);
        }
      })
      .catch((error) => {
        console.warn('Unable to update app zoom.', error);
      });
  }, [effectiveDisplaySettings.appZoom]);

  useEffect(() => {
    const zoomApi = window.qortiumHome.zoom;

    if (!zoomApi) {
      return undefined;
    }

    // Only main-originated zoom changes (keyboard, menu, wheel from a QDN app
    // view) arrive here; renderer-originated zoom:set calls are not echoed.
    return zoomApi.onChanged((percent) => {
      const appZoomControl = appZoomControlRef.current;

      if (!appZoomControl || percent === appZoomControl.current) {
        return;
      }

      appZoomControl.current = percent;
      appZoomControl.update(percent);
    });
  }, []);

  useEffect(() => {
    const menuApi = window.qortiumHome.menu;

    if (!menuApi?.setLabels) {
      return;
    }

    void menuApi
      .setLabels({
        back: t('common.back'),
        closeTab: t('tabs.closeTab'),
        closeWindow: t('menu.closeWindow'),
        copy: t('menu.copy'),
        cut: t('menu.cut'),
        edit: t('menu.edit'),
        file: t('menu.file'),
        focusAddressBar: t('menu.focusAddressBar'),
        forward: t('common.forward'),
        minimize: t('menu.minimize'),
        newTab: t('tabs.newTab'),
        newWindow: t('menu.newWindow'),
        paste: t('menu.paste'),
        quit: t('menu.quit'),
        redo: t('menu.redo'),
        reloadTab: t('tabs.reloadTab'),
        reopenClosedTab: t('tabs.reopenClosedTab'),
        resetZoom: t('menu.resetZoom'),
        selectAll: t('menu.selectAll'),
        toggleFullScreen: t('menu.toggleFullScreen'),
        undo: t('menu.undo'),
        view: t('menu.view'),
        window: t('menu.window'),
        zoom: t('menu.zoom'),
        zoomIn: t('menu.zoomIn'),
        zoomOut: t('menu.zoomOut'),
      })
      .catch((error) => {
        console.warn('Unable to update application menu labels.', error);
      });
  }, [effectiveDisplaySettings.language]);

  function updateDisplaySettings(nextDisplaySettings: DisplaySettings) {
    setDisplaySettings(nextDisplaySettings);

    saveDisplaySettings(nextDisplaySettings).catch((error) => {
      console.warn('Unable to save display settings.', error);
    });
  }

  function toggleStartPage(displayUrl: string) {
    setStartPages((current) => {
      const next = current.some((page) => page.displayUrl === displayUrl)
        ? removeStartPage(current, displayUrl)
        : addStartPage(current, displayUrl, getSavedPageAccountId(displayUrl, activeTab.accountId));

      if (next === current) {
        return current;
      }

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });
  }

  function reorderStartPage(displayUrl: string, direction: -1 | 1) {
    setStartPages((current) => {
      const index = current.findIndex((page) => page.displayUrl === displayUrl);
      const nextIndex = index + direction;

      if (index === -1 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [page] = next.splice(index, 1);
      next.splice(nextIndex, 0, page);

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });
  }

  function handleStartPageRemove(displayUrl: string) {
    setStartPages((current) => {
      const next = removeStartPage(current, displayUrl);

      if (next === current) {
        return current;
      }

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });
  }

  function updateBookmarksState(updateState: (current: BookmarksState) => BookmarksState) {
    setBookmarksState((current) => {
      const next = updateState(current);

      if (next === current) {
        return current;
      }

      saveBookmarksState(next).catch((error) => {
        console.warn('Unable to save bookmarks.', error);
      });

      return next;
    });
  }

  function addBookmarkToFolder(folderId: BookmarkFolderId, request: BookmarkUpdateRequest, parentFolderId?: string | null) {
    let didAdd = false;

    updateBookmarksState((current) => {
      const next = addBookmark(current, folderId, request, parentFolderId);
      didAdd = next !== current;
      return next;
    });

    return didAdd;
  }

  function addBookmarkFolderToFolder(folderId: BookmarkFolderId, request: BookmarkFolderRequest, parentFolderId?: string | null) {
    let didAdd = false;

    updateBookmarksState((current) => {
      const next = addBookmarkFolder(current, folderId, request, parentFolderId);
      didAdd = next !== current;
      return next;
    });

    return didAdd;
  }

  function updateBookmarkInFolder(folderId: BookmarkFolderId, bookmarkId: string, request: BookmarkUpdateRequest) {
    let didUpdate = false;

    updateBookmarksState((current) => {
      const next = updateBookmark(current, folderId, bookmarkId, request);
      didUpdate = next !== current;
      return next;
    });

    return didUpdate;
  }

  function updateBookmarkFolderInFolder(folderId: BookmarkFolderId, bookmarkFolderId: string, request: BookmarkFolderRequest) {
    let didUpdate = false;

    updateBookmarksState((current) => {
      const next = updateBookmarkFolder(current, folderId, bookmarkFolderId, request);
      didUpdate = next !== current;
      return next;
    });

    return didUpdate;
  }

  function removeBookmarkFromFolder(folderId: BookmarkFolderId, bookmarkId: string) {
    updateBookmarksState((current) => removeBookmark(current, folderId, bookmarkId));
  }

  function moveBookmarkInTree(request: BookmarkMoveRequest) {
    updateBookmarksState((current) => moveBookmarkItem(current, request));
  }

  function updateBookmarkToolbarVisibility(visible: boolean) {
    updateBookmarksState((current) => setBookmarkToolbarVisible(current, visible));
  }

  function toggleCurrentBookmark() {
    const currentDisplayUrl = currentRoute.displayUrl;
    const existing = [...flattenBookmarkItems(bookmarksState.bookmarks), ...flattenBookmarkItems(bookmarksState.toolbar)]
      .filter((item) => item.type === 'bookmark')
      .find((bookmark) => bookmark.displayUrl === currentDisplayUrl);

    if (existing) {
      removeBookmarkFromFolder('bookmarks', existing.id);
      removeBookmarkFromFolder('toolbar', existing.id);
      return;
    }

    addBookmarkToFolder('bookmarks', {
      accountId: getSavedPageAccountId(currentDisplayUrl, activeTab.accountId),
      displayUrl: currentDisplayUrl,
      title: getTabLabel(activeTab),
    });
  }

  function updateTheme(nextTheme: DisplaySettings['theme']) {
    updateDisplaySettings({
      ...displaySettings,
      theme: nextTheme,
    });
  }

  function updateLanguage(nextLanguage: DisplaySettings['language']) {
    updateDisplaySettings({
      ...displaySettings,
      language: nextLanguage,
    });
  }

  function updateTextSize(nextTextSize: DisplaySettings['textSize']) {
    updateDisplaySettings({
      ...displaySettings,
      textSize: nextTextSize,
    });
  }

  function updateAppZoom(nextAppZoom: number) {
    updateDisplaySettings({
      ...displaySettings,
      appZoom: clampAppZoom(nextAppZoom),
    });
  }

  function updateAccent(nextAccent: DisplaySettings['accent']) {
    updateDisplaySettings({
      ...displaySettings,
      accent: nextAccent,
    });
  }

  function updateUi(nextUi: DisplaySettings['ui']) {
    updateDisplaySettings({
      ...displaySettings,
      ui: nextUi,
    });
  }

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
    // Reflect the chosen mode immediately so mode-gated UI (e.g. the transport
    // dropdown, which is hidden for Previewnet network) updates the moment the
    // selection changes, rather than after node discovery finishes. Revert if the
    // save fails so the UI doesn't show a mode that wasn't applied.
    let previous: QortiumNodeSettings | null = null;
    setNodeSettings((current) => {
      previous = current;
      return current ? { ...current, mode: request.mode } : current;
    });

    try {
      const settings = await window.qortiumHome.node.saveSettings(request);

      // Renderer-side node requests mirror the settings snapshot through a
      // short-lived cache; a save must take effect immediately, not after TTL.
      invalidateDesktopNodeSettingsCache();
      setNodeSettings(settings);

      return settings;
    } catch (error) {
      setNodeSettings(previous);
      throw error;
    }
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

  const handleNodeAvailable = useCallback(() => {
    setNodeEpoch((currentEpoch) => currentEpoch + 1);
  }, []);

  const handleNodeReachabilityChange = useCallback(() => {
    setNodeEpoch((currentEpoch) => currentEpoch + 1);
  }, []);

  const appUpdates = useAppUpdates({ autoCheck: true });
  const coreManager = useCoreManager({
    nodeEpoch,
    onNodeAvailable: handleNodeAvailable,
    onResolvedNodeApiUrl: updateResolvedNodeApiUrl,
    onSaveNodeSettings: saveNodeSettings,
  });
  const onChainCoreUpdate = useOnChainCoreUpdate(nodeSettings, nodeEpoch);
  const i2pRefreshEpoch = nodeEpoch + connectionRefreshEpoch;

  useEffect(() => {
    if (!didRunInitialRouteRefreshRef.current) {
      didRunInitialRouteRefreshRef.current = true;
      lastRouteRefreshKeyRef.current = routeRefreshKey;
      return;
    }

    if (!routeRefreshKey) {
      lastRouteRefreshKeyRef.current = null;
      return;
    }

    if (lastRouteRefreshKeyRef.current === routeRefreshKey) {
      return;
    }

    lastRouteRefreshKeyRef.current = routeRefreshKey;
    setConnectionRefreshEpoch((currentEpoch) => currentEpoch + 1);

    if (!coreManager.isBusy) {
      void coreManager.refreshStatus({ quiet: true });
    }

    void onChainCoreUpdate.refreshStatus({ quiet: true });
  }, [
    coreManager.isBusy,
    coreManager.refreshStatus,
    onChainCoreUpdate.refreshStatus,
    routeRefreshKey,
  ]);

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

  function focusOpenSettingsTab() {
    // Settings is deduplicated per window: each window is its own renderer with
    // its own tabState, so scanning tabState only sees this window's tabs.
    const existingSettingsTab =
      tabState.tabs.find(
        (tab) => tab.id === tabState.activeTabId && getCurrentRouteForTab(tab).kind === 'settings',
      ) ?? tabState.tabs.find((tab) => getCurrentRouteForTab(tab).kind === 'settings');

    if (!existingSettingsTab) {
      return false;
    }

    selectTab(existingSettingsTab.id);
    return true;
  }

  function navigateToRoute(route: AppRoute, options?: { accountId?: string | null; replace?: boolean }) {
    if (route.kind === 'settings' && focusOpenSettingsTab()) {
      return;
    }

    const defaultAccountId = getDefaultAccountId(accountsState);

    updateActiveTab((tab) => {
      const currentEntry = tab.history.entries[tab.history.index] ?? null;
      const accountId = 'accountId' in (options ?? {})
        ? (accountExists(accountsState, options?.accountId ?? null) ? options?.accountId ?? null : null)
        : accountExists(accountsState, tab.accountId)
          ? tab.accountId
          : defaultAccountId;
      const history =
        currentEntry?.displayUrl === route.displayUrl
          ? tab.history
          : options?.replace
            ? {
                // Swap the current entry in place (dropping any forward entries) so an
                // auto-resolved route does not leave the unresolved one behind in history.
                entries: [...tab.history.entries.slice(0, tab.history.index), route],
                index: tab.history.index,
              }
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

  function openSettingsSection(sectionId: SettingsSectionId) {
    // Open Settings with only the requested section expanded, so the Dashboard
    // tile gears jump straight to the relevant controls.
    setSettingsExpansion({
      core: sectionId === 'core',
      display: sectionId === 'display',
      home: sectionId === 'home',
      node: sectionId === 'node',
    });
    navigateToRoute(SETTINGS_ROUTE);
  }

  function openSettingsInNewTab() {
    if (focusOpenSettingsTab()) {
      return;
    }

    const tab = createBrowserTab(getDefaultAccountId(accountsState), {
      entries: [SETTINGS_ROUTE],
      index: 0,
    });

    setTabState((currentTabState) => ({
      ...currentTabState,
      tabs: [...currentTabState.tabs, tab],
      activeTabId: tab.id,
    }));
  }

  function browseQdn() {
    const parsedUrl = parseAppAddress('qdn://');

    if (parsedUrl.success) {
      navigateToRoute(parsedUrl.route);
    }
  }

  function openCoreApiDocs() {
    const parsedUrl = parseAppAddress('core://');

    if (parsedUrl.success) {
      navigateToRoute(parsedUrl.route);
    }
  }

  function openReleaseNotes(product: 'core' | 'home', tagName: string) {
    navigateToRoute(buildReleaseNotesRoute(product, tagName));
  }

  function resolveSavedItemAccountId(accountId: string | null | undefined) {
    if (accountExists(accountsState, accountId ?? null)) {
      return accountId ?? null;
    }

    return accountExists(accountsState, activeTab.accountId) ? activeTab.accountId : null;
  }

  function updateDashboardPins(updatePins: (currentPins: DashboardPin[]) => DashboardPin[]) {
    const nextPins = updatePins(dashboardPinsRef.current);

    dashboardPinsRef.current = nextPins;
    setDashboardPins(nextPins);

    saveDashboardPins(nextPins).catch((error) => {
      console.warn('Unable to save dashboard pins.', error);
    });
  }

  function pinTabToDashboard(tabId: string) {
    const tab = tabState.tabs.find((candidateTab) => candidateTab.id === tabId);

    if (!tab) {
      return;
    }

    const route = getCurrentRouteForTab(tab);

    if (route.kind === 'dashboard') {
      return;
    }

    const pin = createDashboardPin(route.displayUrl, getTabLabel(tab), getSavedPageAccountId(route.displayUrl, tab.accountId));

    if (!pin) {
      return;
    }

    updateDashboardPins((currentPins) => upsertDashboardPin(currentPins, pin));
  }

  function pinCurrentPageToDashboard() {
    pinTabToDashboard(tabState.activeTabId);
  }

  function openBookmarksManager() {
    navigateToRoute(BOOKMARKS_ROUTE);
  }

  function openSavedAddress(displayUrl: string, accountId?: string | null) {
    const parsedUrl = parseAppAddress(displayUrl);

    if (!parsedUrl.success) {
      console.warn('Ignoring unsupported saved address.', displayUrl);
      return;
    }

    navigateToRoute(parsedUrl.route, { accountId: resolveSavedItemAccountId(accountId) });
  }

  function openBookmark(displayUrl: string, accountId?: string | null) {
    openSavedAddress(displayUrl, accountId);
  }

  function openDashboardPin(pin: DashboardPin) {
    const parsedUrl = parseAppAddress(pin.displayUrl);

    if (!parsedUrl.success) {
      console.warn('Ignoring unsupported dashboard pin.', pin.displayUrl);
      return;
    }

    navigateToRoute(parsedUrl.route, { accountId: resolveSavedItemAccountId(pin.accountId ?? null) });
  }

  function unpinDashboardLink(pinId: string) {
    updateDashboardPins((currentPins) => removeDashboardPin(currentPins, pinId));
  }

  function renameDashboardPin(pinId: string, customLabel: string) {
    updateDashboardPins((currentPins) => setDashboardPinLabel(currentPins, pinId, customLabel));
  }

  function updateDashboardPinFromBookmarks(pinId: string, request: BookmarkUpdateRequest) {
    let didUpdate = false;

    updateDashboardPins((currentPins) => {
      const next = updateDashboardPin(currentPins, pinId, request);
      didUpdate = next !== currentPins;
      return next;
    });

    return didUpdate;
  }

  function reorderDashboardPin(
    draggedPinId: string,
    targetPinId: string,
    dropPosition: DashboardPinDropPosition,
  ) {
    updateDashboardPins((currentPins) =>
      reorderDashboardPins(currentPins, draggedPinId, targetPinId, dropPosition),
    );
  }

  function addDashboardPinFromBookmark(displayUrl: string, title: string, accountId?: string | null) {
    const pin = createDashboardPin(displayUrl, title, getSavedPageAccountId(displayUrl, accountId));

    if (!pin) {
      return false;
    }

    updateDashboardPins((currentPins) => upsertDashboardPin(currentPins, pin));
    return true;
  }

  function addStartPageFromBookmark(displayUrl: string, accountId: string | null, title = '') {
    let didAdd = false;

    setStartPages((current) => {
      const next = addStartPage(current, displayUrl, accountId, title);
      didAdd = next !== current;

      if (next === current) {
        return current;
      }

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });

    return didAdd;
  }

  function addStartPageFromBookmarks(request: BookmarkUpdateRequest) {
    return addStartPageFromBookmark(
      request.displayUrl,
      getSavedPageAccountId(request.displayUrl, request.accountId ?? activeTab.accountId),
      request.title,
    );
  }

  function updateStartPageFromBookmarks(displayUrl: string, request: BookmarkUpdateRequest) {
    let didUpdate = false;

    setStartPages((current) => {
      const next = updateStartPage(current, displayUrl, request);
      didUpdate = next !== current;

      if (next === current) {
        return current;
      }

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });

    return didUpdate;
  }

  function reorderStartPageToTarget(displayUrl: string, targetDisplayUrl: string, dropPosition: DashboardPinDropPosition) {
    setStartPages((current) => {
      if (displayUrl === targetDisplayUrl) {
        return current;
      }

      const page = current.find((candidate) => candidate.displayUrl === displayUrl);

      if (!page) {
        return current;
      }

      const pagesWithoutDragged = current.filter((candidate) => candidate.displayUrl !== displayUrl);
      const targetIndex = pagesWithoutDragged.findIndex((candidate) => candidate.displayUrl === targetDisplayUrl);

      if (targetIndex === -1) {
        return current;
      }

      const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
      const next = [
        ...pagesWithoutDragged.slice(0, insertIndex),
        page,
        ...pagesWithoutDragged.slice(insertIndex),
      ];

      saveStartPages(next).catch((error) => {
        console.warn('Unable to save start pages.', error);
      });

      return next;
    });
  }

  function getBookmarkMovePayload(request: BookmarkRootMoveRequest) {
    if (request.sourceRootId === 'pins') {
      const pin = dashboardPins.find((candidate) => candidate.id === request.itemId);
      return pin ? { accountId: pin.accountId ?? null, displayUrl: pin.displayUrl, title: pin.customLabel || pin.label } : null;
    }

    if (request.sourceRootId === 'startPages') {
      const page = startPages.find((candidate) => candidate.displayUrl === request.itemId);
      return page ? { accountId: page.accountId, displayUrl: page.displayUrl, title: page.title || page.displayUrl } : null;
    }

    const item = findBookmarkItem(bookmarksState[request.sourceRootId], request.itemId);

    if (!item || item.type !== 'bookmark') {
      return null;
    }

    return { accountId: item.accountId ?? null, displayUrl: item.displayUrl, title: item.title };
  }

  function removeBookmarkMoveSource(request: BookmarkRootMoveRequest) {
    if (request.sourceRootId === 'pins') {
      unpinDashboardLink(request.itemId);
      return;
    }

    if (request.sourceRootId === 'startPages') {
      handleStartPageRemove(request.itemId);
      return;
    }

    removeBookmarkFromFolder(request.sourceRootId, request.itemId);
  }

  function moveBookmarkRootItem(request: BookmarkRootMoveRequest) {
    if (request.sourceRootId === request.targetRootId) {
      if (request.sourceRootId === 'pins' && request.targetItemId) {
        reorderDashboardPin(request.itemId, request.targetItemId, request.targetPosition === 'before' ? 'before' : 'after');
        return;
      }

      if (request.sourceRootId === 'startPages' && request.targetItemId) {
        reorderStartPageToTarget(request.itemId, request.targetItemId, request.targetPosition === 'before' ? 'before' : 'after');
        return;
      }

      if (
        (request.sourceRootId === 'bookmarks' || request.sourceRootId === 'toolbar') &&
        (request.targetRootId === 'bookmarks' || request.targetRootId === 'toolbar')
      ) {
        moveBookmarkInTree({
          itemId: request.itemId,
          sourceRootId: request.sourceRootId,
          targetFolderId: request.targetFolderId,
          targetItemId: request.targetItemId,
          targetPosition: request.targetPosition,
          targetRootId: request.targetRootId,
        });
      }

      return;
    }

    const payload = getBookmarkMovePayload(request);

    if (!payload) {
      return;
    }

    if (request.targetRootId === 'pins') {
      if (addDashboardPinFromBookmark(payload.displayUrl, payload.title, payload.accountId)) {
        removeBookmarkMoveSource(request);
      }
      return;
    }

    if (request.targetRootId === 'startPages') {
      if (addStartPageFromBookmark(payload.displayUrl, payload.accountId, payload.title)) {
        removeBookmarkMoveSource(request);
      }
      return;
    }

    const didAdd = addBookmarkToFolder(
      request.targetRootId,
      { accountId: payload.accountId, displayUrl: payload.displayUrl, title: payload.title },
      request.targetFolderId,
    );

    if (didAdd) {
      removeBookmarkMoveSource(request);
    }
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

  function openAppLinkInNewTab(address: string, sourceTabId: string | null) {
    const parsed = parseAppAddress(address);

    if (!parsed.success) {
      console.warn('Ignoring QDN app request to open an unsupported address in a new tab.', address);
      return;
    }

    const sourceTab = tabState.tabs.find((tab) => tab.id === sourceTabId);
    const tab = createBrowserTab(sourceTab ? sourceTab.accountId : getDefaultAccountId(accountsState), {
      entries: [parsed.route],
      index: 0,
    });

    setTabState((currentTabState) => ({
      ...currentTabState,
      tabs: [...currentTabState.tabs, tab],
      activeTabId: tab.id,
    }));
  }

  function openInCurrentTab(address: string, sourceTabId: string | null) {
    const parsed = parseAppAddress(address);

    if (!parsed.success) {
      console.warn('Ignoring QDN app request to navigate current tab to an unsupported address.', address);
      return;
    }

    setTabState((currentTabState) => {
      const targetTab = currentTabState.tabs.find((tab) => tab.id === sourceTabId);

      if (!targetTab) {
        console.warn('Could not find source tab for OPEN_CURRENT_TAB request.', sourceTabId);
        return currentTabState;
      }

      const currentEntry = targetTab.history.entries[targetTab.history.index] ?? null;
      const newHistory =
        currentEntry?.displayUrl === parsed.route.displayUrl
          ? targetTab.history
          : {
              entries: [...targetTab.history.entries.slice(0, targetTab.history.index + 1), parsed.route],
              index: targetTab.history.index + 1,
            };

      return {
        ...currentTabState,
        activeTabId: targetTab.id,
        tabs: currentTabState.tabs.map((tab) =>
          tab.id === targetTab.id ? { ...tab, history: newHistory } : tab,
        ),
      };
    });
  }

  function openQdnMediaPlayer(request: QortiumQdnMediaPlayerRequest) {
    const service = request.service.toUpperCase() as QdnService;

    if (!QDN_MEDIA_PLAYER_SERVICES.includes(service) || !request.name) {
      console.warn('Ignoring QDN app media player request for an unsupported resource.', request);
      return;
    }

    const resource: Omit<QdnResource, 'displayUrl'> = {
      ...(request.identifier ? { identifier: request.identifier } : {}),
      name: request.name,
      path: request.path ?? '',
      service,
    };

    setQdnMediaPlayerResource({ ...resource, displayUrl: buildQdnDisplayUrl(resource) });
  }

  function openQdnDocumentViewer(request: QortiumQdnDocumentViewerRequest) {
    const service = request.service.toUpperCase() as QdnService;

    // The Q-App bridge already restricts which services an app may request to the
    // document whitelist (electron/qdn.ts + platform.ts) before this runs, so the
    // only check needed here is a usable name. This lets the user-initiated
    // "Open in Document Viewer" button work for any resource that resolved to a
    // document content kind, regardless of its publishing service.
    if (!request.name) {
      console.warn('Ignoring QDN document viewer request without a name.', request);
      return;
    }

    const resource: Omit<QdnResource, 'displayUrl'> = {
      ...(request.identifier ? { identifier: request.identifier } : {}),
      name: request.name,
      path: request.path ?? '',
      service,
    };

    setQdnDocumentViewerResource({ ...resource, displayUrl: buildQdnDisplayUrl(resource) });
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

  openAppLinkInNewTabRef.current = openAppLinkInNewTab;
  openInCurrentTabRef.current = openInCurrentTab;
  openQdnMediaPlayerRef.current = openQdnMediaPlayer;
  textSizeControlRef.current = {
    current: effectiveDisplaySettings.textSize,
    update: updateTextSize,
  };
  appZoomControlRef.current = {
    current: effectiveDisplaySettings.appZoom,
    update: updateAppZoom,
  };
  openQdnDocumentViewerRef.current = openQdnDocumentViewer;

  useEffect(() => {
    return window.qortiumHome.menu?.onCommand((command) => {
      const textSizeControl = textSizeControlRef.current;

      if (command === 'text-size-increase') {
        if (textSizeControl) {
          // Advance the ref before React re-renders so rapid routed commands
          // (e.g. Ctrl+Shift+wheel from a QDN app view) step once each instead
          // of collapsing onto the same next preset.
          const nextSize = nextTextSize(textSizeControl.current);
          textSizeControl.current = nextSize;
          textSizeControl.update(nextSize);
        }
        return;
      }

      if (command === 'text-size-decrease') {
        if (textSizeControl) {
          const nextSize = prevTextSize(textSizeControl.current);
          textSizeControl.current = nextSize;
          textSizeControl.update(nextSize);
        }
        return;
      }

      if (command === 'text-size-reset') {
        if (textSizeControl) {
          textSizeControl.current = DEFAULT_TEXT_SIZE;
          textSizeControl.update(DEFAULT_TEXT_SIZE);
        }
        return;
      }

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
    const qdnEvents = window.qortiumHome.qdnEvents;

    if (!qdnEvents?.onOpenNewTab) {
      return undefined;
    }

    return qdnEvents.onOpenNewTab((event) => {
      openAppLinkInNewTabRef.current?.(event.address, event.sourceTabId);
    });
  }, []);

  useEffect(() => {
    const qdnEvents = window.qortiumHome.qdnEvents;

    if (!qdnEvents?.onOpenCurrentTab) {
      return undefined;
    }

    return qdnEvents.onOpenCurrentTab((event) => {
      openInCurrentTabRef.current?.(event.address, event.sourceTabId);
    });
  }, []);

  useEffect(() => {
    const qdnEvents = window.qortiumHome.qdnEvents;

    if (!qdnEvents?.onOpenMediaPlayer) {
      return undefined;
    }

    return qdnEvents.onOpenMediaPlayer((event) => {
      openQdnMediaPlayerRef.current?.(event);
    });
  }, []);

  useEffect(() => {
    const qdnEvents = window.qortiumHome.qdnEvents;

    if (!qdnEvents?.onOpenDocumentViewer) {
      return undefined;
    }

    return qdnEvents.onOpenDocumentViewer((event) => {
      openQdnDocumentViewerRef.current?.(event);
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

    // F6 / Shift+F6 cycle focus through the three browser-like regions:
    // 0 = tab strip, 1 = address bar, 2 = main page content.
    function getCurrentRegionIndex() {
      const active = document.activeElement;

      if (!(active instanceof Element)) {
        return -1;
      }

      if (active.closest('.top-bar__tab-list')) {
        return 0;
      }

      if (active.closest('#browser-address')) {
        return 1;
      }

      if (active.closest('.app-main')) {
        return 2;
      }

      return -1;
    }

    function focusRegion(index: number) {
      if (index === 0) {
        const activeTabButton = document.querySelector<HTMLElement>(
          '.top-bar__tab--active .top-bar__tab-select',
        );
        activeTabButton?.focus();
        return;
      }

      if (index === 1) {
        // Reuse focusAddressBar so F6 select-alls, consistent with Ctrl/Cmd+L.
        const actions = tabCommandActionsRef.current;
        actions?.focusAddressBar();
        return;
      }

      const mainRegion = document.querySelector<HTMLElement>('.app-main');
      mainRegion?.focus();
    }

    function cycleRegionFocus(forward: boolean) {
      const current = getCurrentRegionIndex();
      let nextIndex: number;

      if (current === -1) {
        // Focus is outside all three regions (e.g. a popover): start at the
        // address bar going forward, the main page going backward.
        nextIndex = forward ? 1 : 2;
      } else {
        nextIndex = forward ? (current + 1) % 3 : (current + 2) % 3;
      }

      focusRegion(nextIndex);
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

      if (primaryOnly && event.shiftKey && (key === '+' || key === '=')) {
        const textSizeControl = textSizeControlRef.current;

        if (textSizeControl) {
          runCommand(event, () => {
            textSizeControl.update(nextTextSize(textSizeControl.current));
          });
        }
        return;
      }

      if (primaryOnly && event.shiftKey && (key === '-' || key === '_')) {
        const textSizeControl = textSizeControlRef.current;

        if (textSizeControl) {
          runCommand(event, () => {
            textSizeControl.update(prevTextSize(textSizeControl.current));
          });
        }
        return;
      }

      if (primaryOnly && event.shiftKey && (key === '0' || key === ')')) {
        const textSizeControl = textSizeControlRef.current;

        if (textSizeControl) {
          runCommand(event, () => {
            textSizeControl.update(DEFAULT_TEXT_SIZE);
          });
        }
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

      // F6 / Shift+F6 cycle focus between tab strip, address bar, and main page.
      // Placed above the editable-target guard so it works from any field.
      if (key === 'f6') {
        runCommand(event, () => cycleRegionFocus(!event.shiftKey));
        return;
      }

      // Alt+D focuses the address bar (browser alias for Ctrl/Cmd+L). Needs its
      // own branch because primaryOnly excludes Alt.
      if (event.altKey && !primaryModifier && !event.shiftKey && key === 'd') {
        runCommand(event, actions.focusAddressBar);
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

  useEffect(() => {
    let wheelAccumulator = 0;

    function stepTextSizeControl(direction: 'in' | 'out') {
      const textSizeControl = textSizeControlRef.current;

      if (!textSizeControl) {
        return;
      }

      const nextSize = direction === 'in'
        ? nextTextSize(textSizeControl.current)
        : prevTextSize(textSizeControl.current);

      textSizeControl.current = nextSize;
      textSizeControl.update(nextSize);
    }

    function stepAppZoomControl(direction: 'in' | 'out') {
      const appZoomControl = appZoomControlRef.current;

      if (!appZoomControl) {
        return;
      }

      const currentZoom = appZoomControl.current;
      const nextZoom = stepAppZoom(currentZoom, direction, !!window.qortiumHome.zoom);

      if (nextZoom === currentZoom) {
        return;
      }

      // Advance the ref before React re-renders (like the text-size path) so
      // rapid steps chain correctly; the appZoom effect pushes the settled
      // value to the main process.
      appZoomControl.current = nextZoom;
      appZoomControl.update(nextZoom);
    }

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      // Shift+wheel is remapped to horizontal scroll on some platforms, so
      // fall back to deltaX when deltaY is empty.
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;

      if (delta === 0) {
        return;
      }

      if ((wheelAccumulator > 0 && delta < 0) || (wheelAccumulator < 0 && delta > 0)) {
        wheelAccumulator = 0;
      }

      wheelAccumulator += delta;

      // At most one step per wheel event: a single mouse notch reports a large
      // delta (typically 100), so consuming the whole accumulator here keeps
      // one notch = one step while still letting trackpads' small deltas
      // accumulate across events until they reach the threshold.
      if (Math.abs(wheelAccumulator) < 50) {
        return;
      }

      const direction = wheelAccumulator < 0 ? 'in' : 'out';

      wheelAccumulator = 0;

      if (event.shiftKey) {
        stepTextSizeControl(direction);
      } else {
        stepAppZoomControl(direction);
      }
    }

    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel, true);
    };
  }, []);

  useEffect(() => {
    function handleHistoryMouseButton(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.type !== 'mouseup') {
        return;
      }

      const actions = navigationActionsRef.current;

      if (!actions) {
        return;
      }

      if (event.button === 3 && actions.canGoBack) {
        actions.goBack();
        return;
      }

      if (event.button === 4 && actions.canGoForward) {
        actions.goForward();
      }
    }

    window.addEventListener('mousedown', handleHistoryMouseButton, true);
    window.addEventListener('mouseup', handleHistoryMouseButton, true);

    return () => {
      window.removeEventListener('mousedown', handleHistoryMouseButton, true);
      window.removeEventListener('mouseup', handleHistoryMouseButton, true);
    };
  }, []);

  const isNativeApp = Capacitor.isNativePlatform();
  const appMainClassName = [
    'app-main',
    isDashboardRoute ? 'app-main--dashboard' : '',
    isViewerRoute ? 'app-main--viewer' : '',
    isExplorerRoute ? 'app-main--explorer' : '',
    isSettingsRoute ? 'app-main--settings' : '',
    isBookmarksRoute ? 'app-main--bookmarks' : '',
    isReleaseNotesRoute ? 'app-main--release-notes' : '',
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
        <section className="app-main" aria-label={t('common.appName')}>
          <div className="home-content">
            <h1>{t('common.appName')}</h1>
            <p className={`app-message${nodeSettingsError ? ' app-message--error' : ''}`}>
              {nodeSettingsError || (isLoadingWindowStartupPayload ? t('common.loadingWindow') : t('node.loadingSettings'))}
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
        accountsState={accountsState}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canReopenClosedTab={tabState.closedTabs.length > 0}
        currentRoute={currentRoute}
        historyEntries={routeHistory.entries}
        historyIndex={routeHistory.index}
        bookmarksState={bookmarksState}
        dashboardPins={dashboardPins}
        startPages={startPages}
        tabs={tabState.tabs.map((tab) => ({
          account: accountsState.accounts.find((account) => account.id === tab.accountId) ?? null,
          canPinToDashboard: getCurrentRouteForTab(tab).kind !== 'dashboard',
          displayUrl: getCurrentRouteForTab(tab).displayUrl,
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
        onAddTabToToolbar={(tabId) => {
          const tab = tabState.tabs.find((candidate) => candidate.id === tabId);

          if (!tab) {
            return;
          }

          const route = getCurrentRouteForTab(tab);
          addBookmarkToFolder('toolbar', {
            accountId: getSavedPageAccountId(route.displayUrl, tab.accountId),
            displayUrl: route.displayUrl,
            title: getTabLabel(tab),
          });
        }}
        onMoveBookmarkItem={moveBookmarkRootItem}
        onOpenBookmark={openBookmark}
        onOpenBookmarksManager={openBookmarksManager}
        onMoveTabToNewWindow={window.qortiumHome.windows ? moveTabToNewWindow : undefined}
        onNavigate={navigateToRoute}
        onOpenSettings={openSettingsInNewTab}
        onOverlayOpenChange={setIsTopBarOverlayOpen}
        isCurrentPageBookmarked={isCurrentPageBookmarked}
        canToggleCurrentStartPage={canAddCurrentStartPage}
        canPinCurrentPageToDashboard={currentRoute.kind !== 'dashboard'}
        isCurrentPageStartPage={isCurrentPageStartPage}
        onToggleCurrentBookmark={toggleCurrentBookmark}
        onPinCurrentPageToDashboard={pinCurrentPageToDashboard}
        onPinTabToDashboard={pinTabToDashboard}
        onToggleStartPage={() => toggleStartPage(currentRoute.displayUrl)}
        onReorderTab={reorderTab}
        onReloadTab={reloadTab}
        onReopenClosedTab={reopenClosedTab}
        onAccountsStateChange={handleAccountsStateChange}
        onNodeReachabilityChange={handleNodeReachabilityChange}
        onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
        onSelectTab={selectTab}
        onToolbarVisibleChange={updateBookmarkToolbarVisibility}
        nodeEpoch={nodeEpoch}
        nodeSettings={nodeSettings}
      />
      <section
        className={appMainClassName}
        aria-label={
          isDashboardRoute
            ? t('common.dashboard')
            : isSettingsRoute
              ? t('common.settings')
              : isBookmarksRoute
                ? t('bookmarks.manageTitle')
                : t('viewer.browserPageAria')
        }
        tabIndex={-1}
        onPointerCancel={clearNavigationSwipe}
        onPointerDown={handleMainPointerDown}
        onPointerMove={handleMainPointerMove}
        onPointerUp={handleMainPointerUp}
      >
        {tabState.tabs.map((tab) => {
          const isActiveTab = tab.id === activeTab.id;
          const tabRoute = tab.history.entries[tab.history.index] ?? DASHBOARD_ROUTE;
          const tabAccount =
            accountsState.accounts.find((account) => account.id === tab.accountId) ?? null;
          // Repository file navigation only changes the path within one resource;
          // collapse it to the repo root so the viewer is not remounted (and the
          // file tree refetched) on every file open — the live resource prop still
          // carries the selected path down to the browser.
          const tabRenderKeyUrl =
            tabRoute.kind === 'resource' && getQdnViewerKind(tabRoute.resource.service) === 'repository'
              ? buildQdnDisplayUrl({ ...tabRoute.resource, path: '' })
              : tabRoute.displayUrl;
          const tabRenderKey = `${tab.id}:${tab.reloadNonce}:${tabRenderKeyUrl}`;

          return (
            <div
              key={tab.id}
              className={`app-main__tab${isActiveTab ? '' : ' app-main__tab--hidden'}`}
            >
              {tabRoute.kind === 'node-api' ? (
                <ApiViewer
                  key={tabRenderKey}
                  coreManager={coreManager}
                  nodeEpoch={nodeEpoch}
                  nodeMode={nodeSettings.mode}
                  route={tabRoute}
                />
              ) : tabRoute.kind === 'core-api-docs' ? (
                <CoreApiDocsPage
                  key={tabRenderKey}
                  coreManager={coreManager}
                  displaySettings={effectiveDisplaySettings}
                  nodeEpoch={nodeEpoch}
                  nodeSettings={nodeSettings}
                />
              ) : tabRoute.kind === 'resource' ? (
                <QdnViewer
                  key={tabRenderKey}
                  account={tabAccount}
                  coreManager={coreManager}
                  displaySettings={effectiveDisplaySettings}
                  nodeApiUrl={nodeSettings.nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  nodeMode={nodeSettings.mode}
                  onOpenDocumentViewer={openQdnDocumentViewer}
                  onOpenMediaPlayer={openQdnMediaPlayer}
                  onOpenNewTab={(address) => openAppLinkInNewTab(address, tab.id)}
                  onOpenInCurrentTab={(address) => openInCurrentTab(address, tab.id)}
                  resource={tabRoute.resource}
                  suspended={isQdnViewSuspended || !isActiveTab}
                  tabId={tab.id}
                />
              ) : tabRoute.kind === 'preview' ? (
                <QdnPreviewViewer
                  key={tabRenderKey}
                  account={tabAccount}
                  displaySettings={effectiveDisplaySettings}
                  nodeApiUrl={nodeSettings.nodeApiUrl}
                  onOpenDocumentViewer={openQdnDocumentViewer}
                  onOpenMediaPlayer={openQdnMediaPlayer}
                  onOpenNewTab={(address) => openAppLinkInNewTab(address, tab.id)}
                  onOpenInCurrentTab={(address) => openInCurrentTab(address, tab.id)}
                  preview={tabRoute.preview}
                  suspended={isQdnViewSuspended || !isActiveTab}
                  tabId={tab.id}
                />
              ) : tabRoute.kind === 'settings' ? (
                <SettingsPage
                  appUpdates={appUpdates}
                  coreManager={coreManager}
                  connectionRefreshEpoch={i2pRefreshEpoch}
                  nodeSettings={nodeSettings}
                  onChainCoreUpdate={onChainCoreUpdate}
                  onOpenReleaseNotes={openReleaseNotes}
                  onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
                  onLanguageChange={updateLanguage}
                  onSectionExpansionChange={updateSettingsSectionExpansion}
                  onSaveNodeSettings={saveNodeSettings}
                  onAccentChange={updateAccent}
                  onAppZoomChange={updateAppZoom}
                  onThemeChange={updateTheme}
                  onTextSizeChange={updateTextSize}
                  onUiChange={updateUi}
                  sectionExpansion={settingsExpansion}
                  displaySettings={displaySettings}
                />
              ) : tabRoute.kind === 'bookmarks' ? (
                <BookmarksPage
                  bookmarksState={bookmarksState}
                  dashboardPins={dashboardPins}
                  nodeApiUrl={nodeSettings.nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  accountsState={accountsState}
                  startPages={startPages}
                  onAddBookmark={addBookmarkToFolder}
                  onAddBookmarkFolder={addBookmarkFolderToFolder}
                  onAddDashboardPin={(request) =>
                    addDashboardPinFromBookmark(request.displayUrl, request.title, request.accountId ?? activeTab.accountId)
                  }
                  onAddStartPage={addStartPageFromBookmarks}
                  onMoveBookmarkItem={moveBookmarkRootItem}
                  onOpenAddress={openBookmark}
                  onRemoveBookmark={removeBookmarkFromFolder}
                  onRemoveDashboardPin={unpinDashboardLink}
                  onRemoveStartPage={handleStartPageRemove}
                  onToolbarVisibleChange={updateBookmarkToolbarVisibility}
                  onUpdateBookmark={updateBookmarkInFolder}
                  onUpdateBookmarkFolder={updateBookmarkFolderInFolder}
                  onUpdateDashboardPin={updateDashboardPinFromBookmarks}
                  onUpdateStartPage={updateStartPageFromBookmarks}
                />
              ) : tabRoute.kind === 'release-notes' ? (
                <ReleaseNotesPage key={tabRenderKey} route={tabRoute} onOpenReleaseNotes={openReleaseNotes} />
              ) : tabRoute.kind === 'dashboard' ? (
                <DashboardPage
                  accountsError={accountsError}
                  accountsState={accountsState}
                  appUpdates={appUpdates}
                  coreManager={coreManager}
                  dashboardPins={dashboardPins}
                  isLoadingAccounts={isLoadingAccounts}
                  nodeApiUrl={nodeSettings.nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  connectionRefreshEpoch={i2pRefreshEpoch}
                  nodeSettings={nodeSettings}
                  onChainCoreUpdate={onChainCoreUpdate}
                  onResolvedNodeApiUrl={updateResolvedNodeApiUrl}
                  onSaveNodeSettings={saveNodeSettings}
                  onBrowseQdn={browseQdn}
                  onOpenDashboardPin={openDashboardPin}
                  onOpenCoreApiDocs={openCoreApiDocs}
                  onOpenReleaseNotes={openReleaseNotes}
                  onOpenSettings={openSettings}
                  onOpenSettingsSection={openSettingsSection}
                  onRemoveDashboardPin={unpinDashboardLink}
                  onRenameDashboardPin={renameDashboardPin}
                  onReorderDashboardPin={reorderDashboardPin}
                  selectedAccountId={tab.accountId}
                  onAccountsStateChange={handleAccountsStateChange}
                  onSelectedAccountChange={updateActiveTabAccount}
                />
              ) : (
                <QdnExplorer
                  key={tabRenderKey}
                  coreManager={coreManager}
                  displaySettings={effectiveDisplaySettings}
                  nodeApiUrl={nodeSettings.nodeApiUrl}
                  nodeEpoch={nodeEpoch}
                  nodeMode={nodeSettings.mode}
                  route={tabRoute}
                  onNavigate={navigateToRoute}
                />
              )}
            </div>
          );
        })}
      </section>
      {activeQdnWriteRequest ? (
        <QdnWriteDialog
          request={activeQdnWriteRequest}
          onResolve={resolveQdnWriteRequest}
        />
      ) : null}
      {activeQdnUnlockRequest && !activeQdnWriteRequest ? (
        <QdnUnlockDialog
          request={activeQdnUnlockRequest}
          onAccountsStateChange={handleAccountsStateChange}
          onResolve={resolveQdnUnlockRequest}
        />
      ) : null}
      {qdnMediaPlayerResource && !activeQdnWriteRequest && !activeQdnUnlockRequest && nodeSettings ? (
        <QdnMediaPlayerDialog
          displaySettings={effectiveDisplaySettings}
          nodeApiUrl={nodeSettings.nodeApiUrl}
          onDismiss={() => setQdnMediaPlayerResource(null)}
          resource={qdnMediaPlayerResource}
        />
      ) : null}
      {qdnDocumentViewerResource && !activeQdnWriteRequest && !activeQdnUnlockRequest ? (
        <QdnDocumentViewerDialog
          displaySettings={effectiveDisplaySettings}
          onDismiss={() => setQdnDocumentViewerResource(null)}
          resource={qdnDocumentViewerResource}
        />
      ) : null}
    </main>
  );
}
