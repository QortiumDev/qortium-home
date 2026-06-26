import { ArrowRight, ChevronLeft, ChevronRight, Globe2, LoaderCircle, Lock, Pin, Plus, RefreshCw, Unlock, X } from 'lucide-react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountAvatar } from './AccountAvatar';
import { getAccountProfile } from './accountProfile';
import type { AppIconResolution } from './appIconUtils';
import { getAppIconResolution } from './appIconUtils';
import { AppIcon } from './AppIcon';
import { NodeStatusButton } from './NodeStatusButton';
import { Popover } from './components/Popover';
import { getTranslationLanguage, t, type TranslationKey } from './i18n';
import type { AppRoute } from './routes';
import { parseAppAddress } from './routes';
import { useMenuKeyboard } from './useMenuKeyboard';
import {
  buildQdnDisplayUrl,
  buildQdnNameUrl,
  buildQdnServiceUrl,
  buildQdnWildcardNameUrl,
  parseQdnAddressDraft,
  PUBLIC_QDN_SERVICES,
  readQdnRegisteredNames,
  readQdnResourceListItems,
  type QdnDraftContext,
} from './qdn';

type TopBarProps = {
  activeAccount: QortiumAccountSummary | null;
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canReopenClosedTab: boolean;
  currentRoute: AppRoute;
  historyEntries: AppRoute[];
  historyIndex: number;
  nodeEpoch: number;
  nodeSettings: QortiumNodeSettings;
  tabs: BrowserTabSummary[];
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsToRight: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoToHistoryIndex: (index: number) => void;
  onMoveTabToNewWindow?: (tabId: string) => void;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onNavigate: (route: AppRoute) => void;
  onNodeReachabilityChange: (reachable: boolean) => void;
  onOpenSettings: () => void;
  onOverlayOpenChange?: (isOpen: boolean) => void;
  onPinTabToDashboard: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, dropPosition: TabDropPosition) => void;
  onReloadTab: (tabId: string) => void;
  onReopenClosedTab: () => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSelectTab: (tabId: string) => void;
};

type TabDropPosition = 'after' | 'before';

type BrowserTabSummary = {
  account: QortiumAccountSummary | null;
  canPinToDashboard: boolean;
  displayUrl: string;
  id: string;
  label: string;
};

type TabContextMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

type HistoryButtonProps = {
  canNavigate: boolean;
  direction: 'back' | 'forward';
  historyEntries: AppRoute[];
  historyIndex: number;
  onJump: (index: number) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
  onStep: () => void;
};

type HistoryMenuItem = {
  entry: AppRoute;
  index: number;
};

type AddressSuggestionKind = 'scheme' | 'service' | 'name' | 'identifier' | 'registered-name';

type AddressSuggestion = {
  descriptionKey: TranslationKey;
  kind: AddressSuggestionKind;
  value: string;
};

const SUGGESTION_DEBOUNCE_MS = 280;
const MIN_NAME_QUERY_LENGTH = 1;
const MAX_ADDRESS_SUGGESTIONS = 8;
const SUGGESTION_FETCH_LIMIT = 50;

const ADDRESS_SCHEME_SUGGESTIONS: AddressSuggestion[] = [
  {
    descriptionKey: 'address.suggestionQdn',
    kind: 'scheme',
    value: 'qdn://',
  },
  {
    descriptionKey: 'address.suggestionCore',
    kind: 'scheme',
    value: 'core://',
  },
  {
    descriptionKey: 'address.suggestionHome',
    kind: 'scheme',
    value: 'home://dashboard',
  },
  {
    descriptionKey: 'common.settings',
    kind: 'scheme',
    value: 'home://settings',
  },
];
const TAB_DRAG_OUT_MIN_DISTANCE_PX = 72;
const TAB_DRAG_START_MIN_DISTANCE_PX = 8;

function formatHistoryEntry(entry: AppRoute) {
  if (entry.kind === 'dashboard') {
    return t('common.dashboard');
  }

  if (entry.kind === 'settings') {
    return t('common.settings');
  }

  if (entry.kind === 'core-api-docs') {
    return t('explorer.coreApi');
  }

  return entry.displayUrl;
}

function getDisplayInitial(value: string) {
  const character = value.trim().charAt(0);

  return character ? character.toUpperCase() : '?';
}

// Sort + case-insensitively de-duplicate a list of names/identifiers.
function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result.sort((first, second) => first.localeCompare(second));
}

function buildSuggestionCacheKey(draft: QdnDraftContext) {
  const prefix = draft.prefix.toLowerCase();

  if (draft.kind === 'identifier') {
    return `identifier|${draft.service}|${draft.name.toLowerCase()}|${prefix}`;
  }

  if (draft.kind === 'name') {
    return `name|${draft.service}|${prefix}`;
  }

  if (draft.kind === 'wildcard-name') {
    return `registered|${prefix}`;
  }

  return `service|${prefix}`;
}

// Fetch live suggestions for the segment under the caret. Names within a chosen
// service come from the resource index (so every suggestion is navigable); the
// wildcard form falls back to the full registered-name index.
async function fetchDraftSuggestions(draft: QdnDraftContext): Promise<AddressSuggestion[]> {
  if (draft.kind === 'wildcard-name') {
    const data = await window.qortiumHome.qdn.searchNames({
      query: draft.prefix.trim(),
      prefix: true,
      limit: SUGGESTION_FETCH_LIMIT,
    });

    return dedupeStrings(readQdnRegisteredNames(data))
      .slice(0, MAX_ADDRESS_SUGGESTIONS)
      .map((name): AddressSuggestion => ({
        descriptionKey: 'address.suggestionRegisteredName',
        kind: 'registered-name',
        value: buildQdnWildcardNameUrl(name),
      }));
  }

  if (draft.kind === 'name') {
    const data = await window.qortiumHome.qdn.listResources({
      service: draft.service,
      name: draft.prefix || undefined,
      prefix: true,
      includeStatus: false,
      includeMetadata: false,
      limit: SUGGESTION_FETCH_LIMIT,
    });

    return dedupeStrings(readQdnResourceListItems(data).map((item) => item.name))
      .slice(0, MAX_ADDRESS_SUGGESTIONS)
      .map((name): AddressSuggestion => ({
        descriptionKey: 'address.suggestionName',
        kind: 'name',
        value: buildQdnNameUrl(draft.service, name),
      }));
  }

  if (draft.kind === 'identifier') {
    const data = await window.qortiumHome.qdn.listResources({
      service: draft.service,
      name: draft.name,
      prefix: true,
      includeStatus: false,
      includeMetadata: false,
      limit: SUGGESTION_FETCH_LIMIT,
    });

    const prefixLower = draft.prefix.toLowerCase();
    const identifiers = readQdnResourceListItems(data)
      .filter((item) => item.name.toLowerCase() === draft.name.toLowerCase())
      .map((item) => item.identifier)
      .filter((identifier): identifier is string => typeof identifier === 'string' && identifier.length > 0)
      .filter((identifier) => identifier.toLowerCase().startsWith(prefixLower));

    return dedupeStrings(identifiers)
      .slice(0, MAX_ADDRESS_SUGGESTIONS)
      .map((identifier): AddressSuggestion => ({
        descriptionKey: 'address.suggestionIdentifier',
        kind: 'identifier',
        value: buildQdnDisplayUrl({ service: draft.service, name: draft.name, identifier, path: '' }),
      }));
  }

  return [];
}

// Suggestions that need no network call: the scheme stubs, plus QDN services
// once the user is typing the service segment (qdn://, qdn://ima, …).
function getStaticAddressSuggestions(value: string): AddressSuggestion[] {
  const input = value.trim().toLowerCase();

  if (!input) {
    return [];
  }

  const schemeSuggestions = ADDRESS_SCHEME_SUGGESTIONS.filter((suggestion) => {
    const suggestionValue = suggestion.value.toLowerCase();
    const scheme = suggestionValue.slice(0, suggestionValue.indexOf(':'));

    return (
      input !== suggestionValue &&
      (suggestionValue.startsWith(input) || scheme.startsWith(input))
    );
  });

  const draft = parseQdnAddressDraft(value);

  if (draft?.kind === 'service') {
    const prefix = draft.prefix.toLowerCase();
    const serviceSuggestions: AddressSuggestion[] = PUBLIC_QDN_SERVICES.filter((service) =>
      service.toLowerCase().startsWith(prefix),
    )
      .slice(0, MAX_ADDRESS_SUGGESTIONS)
      .map((service) => ({
        descriptionKey: 'address.suggestionService',
        kind: 'service',
        value: buildQdnServiceUrl(service),
      }));

    return [...schemeSuggestions, ...serviceSuggestions];
  }

  return schemeSuggestions;
}

function getAccountTooltip(account: QortiumAccountSummary, profile: QortiumAccountProfile | null) {
  return [
    profile?.name ?? '',
    profile?.address ?? account.address,
    profile?.label ?? account.label,
  ].filter(Boolean).join('\n');
}

function formatAccountActionError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('account.actionFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function AccountChip({
  account,
  nodeApiUrl,
  nodeEpoch,
  onAccountsStateChange,
  onMenuOpenChange,
}: {
  account: QortiumAccountSummary | null;
  nodeApiUrl: string;
  nodeEpoch: number;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
}) {
  const [profile, setProfile] = useState<QortiumAccountProfile | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [accountError, setAccountError] = useState('');

  useEffect(() => {
    let isDisposed = false;

    setProfile(null);

    if (!account) {
      return () => {
        isDisposed = true;
      };
    }

    getAccountProfile(account, nodeApiUrl, nodeEpoch)
      .then((nextProfile) => {
        if (!isDisposed) {
          setProfile(nextProfile);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setProfile(null);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [account, nodeApiUrl, nodeEpoch]);

  useEffect(() => {
    setIsBusy(false);
    setPassword('');
    setAccountError('');
  }, [account?.id]);

  // Clear any typed password (and error) whenever the menu closes, so a locked
  // account always reopens to a fresh, empty unlock field.
  function handleMenuOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setPassword('');
      setAccountError('');
    }
    onMenuOpenChange?.(isOpen);
  }

  async function handleLock(closeMenu: () => void) {
    if (!account || isBusy || !account.isUnlocked) {
      return;
    }

    setAccountError('');
    setIsBusy(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.lockWallet(account.id);
      onAccountsStateChange(nextAccountsState);
      closeMenu();
    } catch (error) {
      setAccountError(formatAccountActionError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUnlockSubmit(event: FormEvent<HTMLFormElement>, closeMenu: () => void) {
    event.preventDefault();

    if (!account || isBusy) {
      return;
    }

    if (!password) {
      setAccountError(t('account.enterWalletPassword'));
      return;
    }

    setAccountError('');
    setIsBusy(true);

    try {
      const nextAccountsState = await window.qortiumHome.accounts.unlockWallet(account.id, password);
      onAccountsStateChange(nextAccountsState);
      setPassword('');
      closeMenu();
    } catch (error) {
      setAccountError(formatAccountActionError(error));
    } finally {
      setIsBusy(false);
    }
  }

  const displayName = profile?.name ?? account?.label ?? t('account.noAccount');
  const statusLabel = account?.isUnlocked
    ? t('account.statusUnlocked')
    : account
      ? t('account.statusLocked')
      : t('account.noAccountSelected');
  const accountChipTitle = account
    ? t('account.chipTitle', { accountDetails: getAccountTooltip(account, profile), status: statusLabel })
    : statusLabel;

  return (
    <Popover
      className="account-menu"
      contentClassName="account-menu__popover"
      contentId="top-bar-account-menu"
      contentLabel={t('account.menuLabel')}
      onOpenChange={handleMenuOpenChange}
      renderTrigger={({ contentId, isOpen, toggle }) => (
        <button
          className={`account-chip${account?.isUnlocked ? ' account-chip--unlocked' : ''}`}
          title={accountChipTitle}
          type="button"
          aria-controls={isOpen ? contentId : undefined}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={
            account ? t('account.chipAria', { name: displayName, status: statusLabel }) : t('account.chipAriaEmpty')
          }
          onClick={toggle}
        >
          <AccountAvatar
            name={profile?.name ?? null}
            nodeApiUrl={nodeApiUrl}
            nodeEpoch={nodeEpoch}
            imageClassName="account-chip__avatar"
            fallback={
              <span className="account-chip__fallback" aria-hidden="true">
                {getDisplayInitial(displayName)}
              </span>
            }
          />
          {account ? (
            <span
              className={`account-chip__status account-chip__status--${account.isUnlocked ? 'unlocked' : 'locked'}`}
              aria-hidden="true"
            >
              {account.isUnlocked ? <Unlock size={10} strokeWidth={2.4} /> : <Lock size={10} strokeWidth={2.4} />}
            </span>
          ) : null}
          <span className="sr-only">{displayName}</span>
          <span className="sr-only">{statusLabel}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="account-menu__content">
          <div className="account-menu__header">
            <div className="account-menu__identity">
              <strong>{displayName}</strong>
              <span>{statusLabel}</span>
            </div>
          </div>

          {account ? (
            <p className="account-menu__address">{account.address}</p>
          ) : (
            <p className="account-menu__message">{t('account.selectWalletHint')}</p>
          )}

          {accountError ? (
            <p className="account-menu__message account-menu__message--error" role="alert">
              {accountError}
            </p>
          ) : null}

          {account && !account.isUnlocked ? (
            <form className="account-menu__unlock" onSubmit={(event) => void handleUnlockSubmit(event, close)}>
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
              <div className="account-menu__actions">
                <button
                  className="button button--secondary"
                  disabled={isBusy}
                  type="button"
                  onClick={() => {
                    setPassword('');
                    setAccountError('');
                    close();
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button aria-busy={isBusy} className="button button--primary" disabled={isBusy} type="submit">
                  {isBusy ? (
                    <LoaderCircle aria-hidden="true" className="button__spinner" size={18} strokeWidth={2} />
                  ) : (
                    <Unlock aria-hidden="true" size={18} strokeWidth={2} />
                  )}
                  {isBusy ? t('common.unlocking') : t('common.unlock')}
                </button>
              </div>
            </form>
          ) : account ? (
            <div className="account-menu__actions">
              <button
                aria-busy={isBusy}
                className="button"
                disabled={isBusy}
                type="button"
                onClick={() => void handleLock(close)}
              >
                {isBusy ? (
                  <LoaderCircle aria-hidden="true" className="button__spinner" size={18} strokeWidth={2} />
                ) : (
                  <Lock aria-hidden="true" size={18} strokeWidth={2} />
                )}
                {isBusy ? t('common.locking') : t('common.lock')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function getHistoryItems(
  direction: HistoryButtonProps['direction'],
  historyEntries: HistoryButtonProps['historyEntries'],
  historyIndex: number,
) {
  if (direction === 'back') {
    return historyEntries
      .slice(0, historyIndex)
      .map<HistoryMenuItem>((entry, index) => ({ entry, index }))
      .reverse();
  }

  return historyEntries.slice(historyIndex + 1).map<HistoryMenuItem>((entry, offset) => ({
    entry,
    index: historyIndex + offset + 1,
  }));
}

function HistoryButton({
  canNavigate,
  direction,
  historyEntries,
  historyIndex,
  onJump,
  onMenuOpenChange,
  onStep,
}: HistoryButtonProps) {
  const label = direction === 'back' ? t('common.back') : t('common.forward');
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight;
  const language = getTranslationLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenuRef = useRef<() => void>(() => undefined);
  const items = useMemo(
    () => getHistoryItems(direction, historyEntries, historyIndex),
    [direction, historyEntries, historyIndex, language],
  );
  const menuKeyboard = useMenuKeyboard({
    getFocusAfterEscape: () => triggerRef.current,
    isOpen: isMenuOpen,
    menuRef,
    onClose: () => closeMenuRef.current(),
  });

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>, open: () => void) {
    event.preventDefault();

    if (canNavigate) {
      open();
    }
  }

  return (
    <Popover
      className={`top-bar__history top-bar__history--${direction}`}
      contentClassName={`top-bar__history-popover top-bar__history-popover--${direction}`}
      contentId={`top-bar-${direction}-history`}
      contentLabel={direction === 'back' ? t('address.backHistory') : t('address.forwardHistory')}
      contentRole="menu"
      onOpenChange={(isOpen) => {
        setIsMenuOpen(isOpen);
        onMenuOpenChange?.(isOpen);
      }}
      renderTrigger={({ close, contentId, isOpen, open }) => {
        closeMenuRef.current = close;

        return (
          <button
            className="icon-button top-bar__history-button"
            ref={triggerRef}
            disabled={!canNavigate}
            title={direction === 'back' ? t('address.backButtonTitle') : t('address.forwardButtonTitle')}
            type="button"
            aria-controls={isOpen ? contentId : undefined}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            onClick={() => {
              close();
              onStep();
            }}
            onContextMenu={(event) => handleContextMenu(event, open)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && canNavigate) {
                event.preventDefault();
                open();
              }
            }}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={2} />
            <span className="sr-only">{label}</span>
          </button>
        );
      }}
    >
      {({ close }) => (
        <div className="top-bar__history-menu" ref={menuRef} onKeyDown={menuKeyboard.onKeyDown}>
          {items.map((item) => (
            <button
              className="top-bar__history-menu-item"
              key={`${item.index}:${formatHistoryEntry(item.entry)}`}
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                onJump(item.index);
              }}
            >
              <span className="top-bar__history-menu-label">{formatHistoryEntry(item.entry)}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function TabAvatar({
  account,
  nodeApiUrl,
  nodeEpoch,
}: {
  account: QortiumAccountSummary | null;
  nodeApiUrl: string;
  nodeEpoch: number;
}) {
  const [profile, setProfile] = useState<QortiumAccountProfile | null>(null);

  useEffect(() => {
    let isDisposed = false;

    setProfile(null);

    if (!account) {
      return () => {
        isDisposed = true;
      };
    }

    getAccountProfile(account, nodeApiUrl, nodeEpoch)
      .then((nextProfile) => {
        if (!isDisposed) {
          setProfile(nextProfile);
        }
      })
      .catch(() => {
        if (!isDisposed) {
          setProfile(null);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [account, nodeApiUrl, nodeEpoch]);

  if (!account) {
    return null;
  }

  const displayName = profile?.name ?? account.label;

  return (
    <span
      className={`top-bar__tab-avatar${account.isUnlocked ? ' top-bar__tab-avatar--unlocked' : ''}`}
      title={displayName}
    >
      <AccountAvatar
        name={profile?.name ?? null}
        nodeApiUrl={nodeApiUrl}
        nodeEpoch={nodeEpoch}
        imageClassName="top-bar__tab-avatar-image"
        fallback={
          <span className="top-bar__tab-avatar-fallback" aria-hidden="true">
            {getDisplayInitial(displayName)}
          </span>
        }
      />
    </span>
  );
}

function BrowserTabs({
  activeTabId,
  canReopenClosedTab,
  onAddTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onDuplicateTab,
  onMoveTabToNewWindow,
  onPinTabToDashboard,
  onReorderTab,
  onReloadTab,
  onReopenClosedTab,
  onSelectTab,
  onMenuOpenChange,
  nodeApiUrl,
  nodeEpoch,
  tabs,
}: {
  activeTabId: string;
  canReopenClosedTab: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsToRight: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onMoveTabToNewWindow?: (tabId: string) => void;
  onPinTabToDashboard: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, dropPosition: TabDropPosition) => void;
  onReloadTab: (tabId: string) => void;
  onReopenClosedTab: () => void;
  onSelectTab: (tabId: string) => void;
  onMenuOpenChange?: (isOpen: boolean) => void;
  tabs: BrowserTabSummary[];
}) {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const dragStateRef = useRef<{
    hasReordered: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    tabId: string;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuFocusTargetRef = useRef<HTMLElement | null>(null);
  const suppressedClickTabIdRef = useRef<string | null>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabElementsRef = useRef(new Map<string, HTMLDivElement>());
  const contextMenuTabIndex = contextMenu
    ? tabs.findIndex((tab) => tab.id === contextMenu.tabId)
    : -1;
  const contextMenuTab = contextMenuTabIndex === -1 ? null : tabs[contextMenuTabIndex];
  const hasTabsToRight = contextMenuTabIndex !== -1 && contextMenuTabIndex < tabs.length - 1;
  const hasOtherTabs = contextMenuTabIndex !== -1 && tabs.length > 1;
  const tabMenuKeyboard = useMenuKeyboard({
    getFocusAfterEscape: () => contextMenuFocusTargetRef.current,
    isOpen: !!contextMenu,
    menuRef: contextMenuRef,
    onClose: () => setContextMenu(null),
  });

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    function closeOnPointerDown(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!contextMenuRef.current?.contains(event.target)) {
        setContextMenu(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    onMenuOpenChange?.(!!contextMenu);
  }, [contextMenu, onMenuOpenChange]);

  useEffect(() => {
    return () => {
      onMenuOpenChange?.(false);
    };
  }, [onMenuOpenChange]);

  function suppressNextTabClick(tabId: string) {
    suppressedClickTabIdRef.current = tabId;
    window.setTimeout(() => {
      if (suppressedClickTabIdRef.current === tabId) {
        suppressedClickTabIdRef.current = null;
      }
    }, 0);
  }

  function clearDragState(event?: PointerEvent<HTMLElement>, selectTabOnRelease = false) {
    if (event && dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    const dragState = dragStateRef.current;

    if (dragState?.hasReordered) {
      suppressNextTabClick(dragState.tabId);
    } else if (dragState && selectTabOnRelease) {
      onSelectTab(dragState.tabId);
      suppressNextTabClick(dragState.tabId);
    }

    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setDraggedTabId(null);
  }

  function getReorderTarget(pointerClientX: number, sourceTabId: string) {
    const currentIndex = tabs.findIndex((tab) => tab.id === sourceTabId);

    if (currentIndex === -1 || tabs.length < 2) {
      return null;
    }

    const tabsWithoutDraggedTab = tabs.filter((tab) => tab.id !== sourceTabId);
    let targetTabId = tabsWithoutDraggedTab[tabsWithoutDraggedTab.length - 1]?.id;
    let dropPosition: TabDropPosition = 'after';

    for (const tab of tabsWithoutDraggedTab) {
      const element = tabElementsRef.current.get(tab.id);

      if (!element) {
        continue;
      }

      const bounds = element.getBoundingClientRect();

      if (pointerClientX < bounds.left + bounds.width / 2) {
        targetTabId = tab.id;
        dropPosition = 'before';
        break;
      }
    }

    if (!targetTabId) {
      return null;
    }

    const targetIndex = tabsWithoutDraggedTab.findIndex((tab) => tab.id === targetTabId);
    const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;

    if (insertIndex === currentIndex) {
      return null;
    }

    return {
      dropPosition,
      targetTabId,
    };
  }

  function isDragOutRelease(event: PointerEvent<HTMLElement>, dragState: NonNullable<typeof dragStateRef.current>) {
    if (!onMoveTabToNewWindow) {
      return false;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance < TAB_DRAG_OUT_MIN_DISTANCE_PX) {
      return false;
    }

    if (
      event.clientX < 0 ||
      event.clientX > window.innerWidth ||
      event.clientY < 0 ||
      event.clientY > window.innerHeight
    ) {
      return true;
    }

    const tabStripBounds = tabStripRef.current?.getBoundingClientRect();

    if (!tabStripBounds) {
      return false;
    }

    if (event.clientY < tabStripBounds.top) {
      return tabStripBounds.top - event.clientY >= TAB_DRAG_OUT_MIN_DISTANCE_PX;
    }

    if (event.clientY > tabStripBounds.bottom) {
      return event.clientY - tabStripBounds.bottom >= TAB_DRAG_OUT_MIN_DISTANCE_PX;
    }

    return false;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, tabId: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('.top-bar__tab-close')) {
      return;
    }

    dragStateRef.current = {
      hasReordered: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tabId,
    };
    setDraggedTabId(tabId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (
      !dragState.hasReordered &&
      Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) <
        TAB_DRAG_START_MIN_DISTANCE_PX
    ) {
      return;
    }

    const reorderTarget = getReorderTarget(event.clientX, dragState.tabId);

    if (!reorderTarget) {
      return;
    }

    dragState.hasReordered = true;
    onReorderTab(dragState.tabId, reorderTarget.targetTabId, reorderTarget.dropPosition);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (isDragOutRelease(event, dragState)) {
      const tabId = dragState.tabId;

      suppressNextTabClick(tabId);
      clearDragState(event);
      onMoveTabToNewWindow?.(tabId);
      return;
    }

    clearDragState(event, true);
  }

  function openTabContextMenuAt(
    tabId: string,
    clientX: number,
    clientY: number,
    focusTarget: HTMLElement | null,
  ) {
    // The menu is sized in em (15em wide), so estimate its bounds from the scaled root font size.
    const rootFontSizePx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const menuWidth = 15 * rootFontSizePx;
    const menuHeight = (onMoveTabToNewWindow ? 22.25 : 19.75) * rootFontSizePx;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

    contextMenuFocusTargetRef.current = focusTarget;
    setContextMenu({
      tabId,
      x: Math.max(margin, Math.min(clientX, maxX)),
      y: Math.max(margin, Math.min(clientY, maxY)),
    });
  }

  function handleTabContextMenu(event: MouseEvent<HTMLDivElement>, tabId: string) {
    event.preventDefault();
    clearDragState();
    openTabContextMenuAt(
      tabId,
      event.clientX,
      event.clientY,
      event.currentTarget.querySelector<HTMLButtonElement>('.top-bar__tab-select'),
    );
  }

  function runTabMenuCommand(command: () => void | Promise<void>) {
    setContextMenu(null);
    void command();
  }

  function focusTabSelect(index: number) {
    const targetTab = tabs[index];

    if (!targetTab) {
      return;
    }

    const tabElement = tabElementsRef.current.get(targetTab.id);
    const selectButton = tabElement?.querySelector<HTMLButtonElement>('.top-bar__tab-select');

    selectButton?.focus();
  }

  // Browser-style Left/Right (and Home/End) move focus between tab buttons while
  // focus is in the tab strip. Focus only — Enter/Space still activates the tab.
  function handleTabSelectKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tabId: string) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      openTabContextMenuAt(tabId, bounds.left, bounds.bottom, event.currentTarget);
      return;
    }

    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);

    if (currentIndex === -1) {
      return;
    }

    let nextIndex: number | null = null;

    if (event.key === 'ArrowLeft') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      nextIndex = Math.min(tabs.length - 1, currentIndex + 1);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null || nextIndex === currentIndex) {
      return;
    }

    event.preventDefault();
    focusTabSelect(nextIndex);
  }

  const tabIconResolutions = useMemo(() => {
    const resolutions = new Map<string, AppIconResolution | null>();

    for (const tab of tabs) {
      resolutions.set(tab.id, getAppIconResolution(tab.displayUrl, nodeApiUrl, nodeEpoch));
    }

    return resolutions;
  }, [tabs, nodeApiUrl, nodeEpoch]);

  return (
    <div className="top-bar__tabs" ref={tabStripRef}>
      <div
        className="top-bar__tab-list"
        role="tablist"
        aria-label={t('tabs.listLabel')}
        onDoubleClick={(event) => {
          if (event.currentTarget === event.target) {
            onAddTab();
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const iconResolution = tabIconResolutions.get(tab.id) ?? null;

          return (
            <div
              className={`top-bar__tab${isActive ? ' top-bar__tab--active' : ''}${
                draggedTabId === tab.id ? ' top-bar__tab--dragging' : ''
              }`}
              key={tab.id}
              ref={(element) => {
                if (element) {
                  tabElementsRef.current.set(tab.id, element);
                } else {
                  tabElementsRef.current.delete(tab.id);
                }
              }}
              role="presentation"
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              onLostPointerCapture={clearDragState}
              onPointerCancel={clearDragState}
              onPointerDown={(event) => handlePointerDown(event, tab.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
            >
              <button
                className="top-bar__tab-select"
                role="tab"
                type="button"
                title={tab.label}
                aria-selected={isActive}
                onKeyDown={(event) => handleTabSelectKeyDown(event, tab.id)}
                onClick={(event) => {
                  if (suppressedClickTabIdRef.current === tab.id) {
                    suppressedClickTabIdRef.current = null;
                    event.preventDefault();
                    return;
                  }

                  onSelectTab(tab.id);
                }}
              >
                <span className="top-bar__tab-icons">
                  <TabAvatar account={tab.account} nodeApiUrl={nodeApiUrl} nodeEpoch={nodeEpoch} />
                  {iconResolution ? (
                    <AppIcon resolution={iconResolution} size={26} variant="tab" />
                  ) : null}
                </span>
                <span className="top-bar__tab-label">{tab.label}</span>
              </button>
              <button
                className="top-bar__tab-close"
                type="button"
                title={t('tabs.closeNamed', { label: tab.label })}
                aria-label={t('tabs.closeNamed', { label: tab.label })}
                onClick={() => onCloseTab(tab.id)}
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="icon-button top-bar__new-tab" title={t('tabs.newTab')} type="button" onClick={onAddTab}>
        <Plus aria-hidden="true" size={20} strokeWidth={2} />
        <span className="sr-only">{t('tabs.newTab')}</span>
      </button>
      {contextMenu && contextMenuTab ? (
        <div
          className="top-bar__tab-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={t('tabs.contextMenuLabel', { label: contextMenuTab.label })}
          onKeyDown={tabMenuKeyboard.onKeyDown}
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            className="top-bar__tab-menu-item"
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(onAddTab)}
          >
            {t('tabs.newTab')}
          </button>
          <button
            className="top-bar__tab-menu-item"
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onReloadTab(contextMenuTab.id))}
          >
            {t('tabs.reloadTab')}
          </button>
          <button
            className="top-bar__tab-menu-item"
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onDuplicateTab(contextMenuTab.id))}
          >
            {t('tabs.duplicateTab')}
          </button>
          <button
            className="top-bar__tab-menu-item"
            disabled={!contextMenuTab.canPinToDashboard}
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onPinTabToDashboard(contextMenuTab.id))}
          >
            <Pin aria-hidden="true" size={16} strokeWidth={2} />
            {t('tabs.pinToDashboard')}
          </button>
          {onMoveTabToNewWindow ? (
            <button
              className="top-bar__tab-menu-item"
              role="menuitem"
              type="button"
              onClick={() => runTabMenuCommand(() => onMoveTabToNewWindow(contextMenuTab.id))}
            >
              {t('tabs.moveTabToNewWindow')}
            </button>
          ) : null}
          <div className="top-bar__tab-menu-separator" role="separator" />
          <button
            className="top-bar__tab-menu-item"
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onCloseTab(contextMenuTab.id))}
          >
            {t('tabs.closeTab')}
          </button>
          <button
            className="top-bar__tab-menu-item"
            disabled={!hasOtherTabs}
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onCloseOtherTabs(contextMenuTab.id))}
          >
            {t('tabs.closeOtherTabs')}
          </button>
          <button
            className="top-bar__tab-menu-item"
            disabled={!hasTabsToRight}
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(() => onCloseTabsToRight(contextMenuTab.id))}
          >
            {t('tabs.closeTabsToRight')}
          </button>
          <div className="top-bar__tab-menu-separator" role="separator" />
          <button
            className="top-bar__tab-menu-item"
            disabled={!canReopenClosedTab}
            role="menuitem"
            type="button"
            onClick={() => runTabMenuCommand(onReopenClosedTab)}
          >
            {t('tabs.reopenClosedTab')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  activeAccount,
  activeTabId,
  canGoBack,
  canGoForward,
  canReopenClosedTab,
  currentRoute,
  historyEntries,
  historyIndex,
  nodeEpoch,
  nodeSettings,
  tabs,
  onAddTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onDuplicateTab,
  onGoBack,
  onGoForward,
  onGoToHistoryIndex,
  onMoveTabToNewWindow,
  onAccountsStateChange,
  onNavigate,
  onNodeReachabilityChange,
  onOpenSettings,
  onOverlayOpenChange,
  onPinTabToDashboard,
  onReorderTab,
  onReloadTab,
  onReopenClosedTab,
  onResolvedNodeApiUrl,
  onSelectTab,
}: TopBarProps) {
  const [addressValue, setAddressValue] = useState('');
  const [addressError, setAddressError] = useState('');
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(0);
  const [addressSuggestionsOpen, setAddressSuggestionsOpen] = useState(true);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const addressSuggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const addressSuggestionCacheRef = useRef(new Map<string, AddressSuggestion[]>());
  // True while a click is bringing the (previously unfocused) address bar into
  // focus, so the focus-time select-all isn't immediately collapsed by mouseup.
  const selectAddressOnFocusRef = useRef(false);
  const [dynamicAddressSuggestions, setDynamicAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const staticAddressSuggestions = useMemo(() => getStaticAddressSuggestions(addressValue), [addressValue]);
  const addressSuggestions = useMemo(
    () => [...staticAddressSuggestions, ...dynamicAddressSuggestions].slice(0, MAX_ADDRESS_SUGGESTIONS),
    [staticAddressSuggestions, dynamicAddressSuggestions],
  );
  const activeAddressSuggestionIndex = addressSuggestions.length > 0
    ? Math.min(addressSuggestionIndex, addressSuggestions.length - 1)
    : -1;
  const selectedAddressSuggestion =
    addressSuggestionsOpen && addressSuggestions.length > 0
      ? addressSuggestions[activeAddressSuggestionIndex]
      : null;
  const [overlayOpenById, setOverlayOpenById] = useState<Record<string, boolean>>({});
  const setOverlayOpen = useCallback((overlayId: string, isOpen: boolean) => {
    setOverlayOpenById((currentState) => {
      if (currentState[overlayId] === isOpen) {
        return currentState;
      }

      return {
        ...currentState,
        [overlayId]: isOpen,
      };
    });
  }, []);
  const setTabMenuOpen = useCallback((isOpen: boolean) => setOverlayOpen('tab-menu', isOpen), [setOverlayOpen]);
  const setBackHistoryOpen = useCallback((isOpen: boolean) => setOverlayOpen('back-history', isOpen), [setOverlayOpen]);
  const setForwardHistoryOpen = useCallback(
    (isOpen: boolean) => setOverlayOpen('forward-history', isOpen),
    [setOverlayOpen],
  );
  const setAccountMenuOpen = useCallback((isOpen: boolean) => setOverlayOpen('account-menu', isOpen), [setOverlayOpen]);
  const setNodeMenuOpen = useCallback((isOpen: boolean) => setOverlayOpen('node-menu', isOpen), [setOverlayOpen]);
  const isOverlayOpen = Object.values(overlayOpenById).some(Boolean);

  useEffect(() => {
    setAddressValue(currentRoute.displayUrl);
    setAddressError('');
    setAddressSuggestionIndex(0);
    setAddressSuggestionsOpen(false);
  }, [activeTabId, currentRoute]);

  useEffect(() => {
    setAddressSuggestionIndex(0);
  }, [addressValue]);

  // Live name / identifier / registered-name suggestions for the segment under
  // the caret. Debounced, cached, and ignored if superseded by a newer keystroke
  // or if the node is unreachable — never blocks typing or surfaces an error.
  useEffect(() => {
    // Skip while the dropdown is closed (e.g. right after navigating, when the
    // address bar holds a fully-resolved URL) — nothing would consume the result.
    if (!addressSuggestionsOpen) {
      setDynamicAddressSuggestions([]);
      return undefined;
    }

    const draft = parseQdnAddressDraft(addressValue);

    if (!draft || draft.kind === 'service') {
      setDynamicAddressSuggestions([]);
      return undefined;
    }

    if (draft.kind === 'wildcard-name' && draft.prefix.trim().length < MIN_NAME_QUERY_LENGTH) {
      setDynamicAddressSuggestions([]);
      return undefined;
    }

    const cacheKey = buildSuggestionCacheKey(draft);
    const cached = addressSuggestionCacheRef.current.get(cacheKey);

    if (cached) {
      setDynamicAddressSuggestions(cached);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const suggestions = await fetchDraftSuggestions(draft);

          if (cancelled) {
            return;
          }

          addressSuggestionCacheRef.current.set(cacheKey, suggestions);
          setDynamicAddressSuggestions(suggestions);
        } catch {
          if (!cancelled) {
            setDynamicAddressSuggestions([]);
          }
        }
      })();
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addressValue, addressSuggestionsOpen]);

  useEffect(() => {
    if (!addressSuggestionsOpen || addressSuggestions.length === 0) {
      return undefined;
    }

    function closeAddressSuggestionsOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      setAddressSuggestionsOpen(false);
      addressInputRef.current?.focus();
    }

    document.addEventListener('keydown', closeAddressSuggestionsOnEscape);

    return () => {
      document.removeEventListener('keydown', closeAddressSuggestionsOnEscape);
    };
  }, [addressSuggestions.length, addressSuggestionsOpen]);

  useEffect(() => {
    setOverlayOpen('address-suggestions', addressSuggestionsOpen && addressSuggestions.length > 0);
  }, [addressSuggestions.length, addressSuggestionsOpen, setOverlayOpen]);

  useEffect(() => {
    onOverlayOpenChange?.(isOverlayOpen);
  }, [isOverlayOpen, onOverlayOpenChange]);

  useEffect(() => {
    return () => {
      onOverlayOpenChange?.(false);
    };
  }, [onOverlayOpenChange]);

  function focusAddressSuggestion(index: number) {
    window.requestAnimationFrame(() => {
      addressSuggestionRefs.current[index]?.focus();
    });
  }

  function moveAddressSuggestionFocus(index: number) {
    const nextIndex = Math.max(0, Math.min(index, addressSuggestions.length - 1));

    setAddressSuggestionsOpen(true);
    setAddressSuggestionIndex(nextIndex);
    focusAddressSuggestion(nextIndex);
  }

  function applyAddressSuggestion(suggestion = selectedAddressSuggestion) {
    if (!suggestion) {
      return;
    }

    setAddressValue(suggestion.value);
    setAddressError('');
    setAddressSuggestionsOpen(false);

    // The input is controlled, so refocus and place the caret at the end after
    // React has committed the new value. This also covers the mouse-click path,
    // where focus would otherwise stay on the suggestion button.
    const caretPosition = suggestion.value.length;

    window.requestAnimationFrame(() => {
      const input = addressInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.setSelectionRange(caretPosition, caretPosition);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const navigate = (route: AppRoute) => {
      setAddressError('');
      setAddressValue(route.displayUrl);
      setAddressSuggestionsOpen(false);
      onNavigate(route);
    };

    // Prefer the address the user actually typed when it already resolves to a
    // valid route, so an auto-highlighted completion can't hijack a complete
    // address on Enter. Fall back to the highlighted suggestion only for partial
    // input (e.g. "qd" → qdn://, "qdn://im" → the first matching service).
    const typed = parseAppAddress(addressValue);

    if (typed.success) {
      navigate(typed.route);
      return;
    }

    if (selectedAddressSuggestion) {
      const parsedSuggestion = parseAppAddress(selectedAddressSuggestion.value);

      if (parsedSuggestion.success) {
        navigate(parsedSuggestion.route);
        return;
      }
    }

    setAddressError(typed.message);
  }

  return (
    <header className="top-bar">
      <BrowserTabs
        activeTabId={activeTabId}
        canReopenClosedTab={canReopenClosedTab}
        nodeApiUrl={nodeSettings.nodeApiUrl}
        nodeEpoch={nodeEpoch}
        tabs={tabs}
        onAddTab={onAddTab}
        onCloseTab={onCloseTab}
        onCloseOtherTabs={onCloseOtherTabs}
        onCloseTabsToRight={onCloseTabsToRight}
        onDuplicateTab={onDuplicateTab}
        onMoveTabToNewWindow={onMoveTabToNewWindow}
        onPinTabToDashboard={onPinTabToDashboard}
        onReorderTab={onReorderTab}
        onReloadTab={onReloadTab}
        onReopenClosedTab={onReopenClosedTab}
        onSelectTab={onSelectTab}
        onMenuOpenChange={setTabMenuOpen}
      />
      <form className="top-bar__address-form" onSubmit={handleSubmit}>
        <HistoryButton
          canNavigate={canGoBack}
          direction="back"
          historyEntries={historyEntries}
          historyIndex={historyIndex}
          onJump={onGoToHistoryIndex}
          onMenuOpenChange={setBackHistoryOpen}
          onStep={onGoBack}
        />
        <HistoryButton
          canNavigate={canGoForward}
          direction="forward"
          historyEntries={historyEntries}
          historyIndex={historyIndex}
          onJump={onGoToHistoryIndex}
          onMenuOpenChange={setForwardHistoryOpen}
          onStep={onGoForward}
        />
        <button
          className="icon-button top-bar__reload-button"
          title={t('address.reloadPage')}
          type="button"
          onClick={() => onReloadTab(activeTabId)}
        >
          <RefreshCw aria-hidden="true" size={20} strokeWidth={2} />
          <span className="sr-only">{t('address.reloadPage')}</span>
        </button>
        <label className="sr-only" htmlFor="browser-address">
          {t('address.label')}
        </label>
        <div className="top-bar__address-control">
          <Globe2 aria-hidden="true" className="top-bar__address-icon" size={20} strokeWidth={2} />
          <input
            autoComplete="off"
            className="top-bar__address-input"
            id="browser-address"
            placeholder={t('address.placeholder')}
            spellCheck={false}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="browser-address-suggestions"
            aria-expanded={addressSuggestionsOpen && addressSuggestions.length > 0}
            aria-activedescendant={
              selectedAddressSuggestion ? `browser-address-suggestion-${activeAddressSuggestionIndex}` : undefined
            }
            ref={addressInputRef}
            value={addressValue}
            onChange={(event) => {
              setAddressValue(event.target.value);
              setAddressError('');
              setAddressSuggestionsOpen(true);
            }}
            onMouseDown={(event) => {
              // Select-all only on the click that first focuses the field; later
              // clicks should position the caret / allow manual selection.
              if (document.activeElement !== event.currentTarget) {
                selectAddressOnFocusRef.current = true;
              }
            }}
            onMouseUp={(event) => {
              if (selectAddressOnFocusRef.current) {
                event.preventDefault();
                selectAddressOnFocusRef.current = false;
              }
            }}
            onFocus={(event) => {
              // Highlight the whole address so the user can type straight over it.
              event.currentTarget.select();

              if (addressSuggestions.length > 0) {
                setAddressSuggestionsOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && addressSuggestions.length > 0) {
                event.preventDefault();
                moveAddressSuggestionFocus(addressSuggestionsOpen ? activeAddressSuggestionIndex : 0);
                return;
              }

              if (event.key === 'ArrowUp' && addressSuggestions.length > 0) {
                event.preventDefault();
                moveAddressSuggestionFocus(addressSuggestions.length - 1);
                return;
              }

              if (event.key === 'Escape' && addressSuggestionsOpen) {
                event.preventDefault();
                setAddressSuggestionsOpen(false);
                return;
              }

              // Right arrow accepts the highlighted suggestion (fill only, no
              // navigation) when the caret is at the end with nothing selected;
              // otherwise it moves the cursor normally.
              if (event.key === 'ArrowRight' && selectedAddressSuggestion) {
                const input = event.currentTarget;
                const caretAtEnd =
                  input.selectionStart === input.selectionEnd &&
                  input.selectionStart === input.value.length;

                if (caretAtEnd) {
                  event.preventDefault();
                  applyAddressSuggestion();
                  return;
                }
              }

              // Tab fills only (like Right). Enter is intentionally left to the
              // form submit so it can accept and navigate (see handleSubmit).
              if (event.key === 'Tab' && selectedAddressSuggestion) {
                event.preventDefault();
                applyAddressSuggestion();
              }
            }}
          />
          {addressSuggestionsOpen && addressSuggestions.length > 0 ? (
            <div
              className="top-bar__address-suggestions"
              id="browser-address-suggestions"
              role="listbox"
            >
              {addressSuggestions.map((suggestion, index) => (
                <button
                  aria-selected={index === activeAddressSuggestionIndex}
                  className={[
                    'top-bar__address-suggestion',
                    index === activeAddressSuggestionIndex ? 'top-bar__address-suggestion--active' : '',
                  ].filter(Boolean).join(' ')}
                  id={`browser-address-suggestion-${index}`}
                  key={`${suggestion.kind}:${suggestion.value}`}
                  ref={(element) => {
                    addressSuggestionRefs.current[index] = element;
                  }}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setAddressSuggestionIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveAddressSuggestionFocus((index + 1) % addressSuggestions.length);
                      return;
                    }
  
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
  
                      if (index === 0) {
                        addressInputRef.current?.focus();
                        return;
                      }
  
                      moveAddressSuggestionFocus(index - 1);
                      return;
                    }
  
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setAddressSuggestionsOpen(false);
                      addressInputRef.current?.focus();
                      return;
                    }
  
                    if (event.key === 'Tab') {
                      event.preventDefault();
                      applyAddressSuggestion(suggestion);
                    }
                  }}
                  onClick={() => applyAddressSuggestion(suggestion)}
                >
                  <span className="top-bar__address-suggestion-value">{suggestion.value}</span>
                  <span className="top-bar__address-suggestion-label">{t(suggestion.descriptionKey)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {addressError ? <p className="top-bar__error">{addressError}</p> : null}
        </div>
        <button className="icon-button top-bar__go-button" title={t('address.loadAddress')} type="submit">
          <ArrowRight aria-hidden="true" size={20} strokeWidth={2} />
          <span className="sr-only">{t('address.loadAddress')}</span>
        </button>
      </form>
      <AccountChip
        account={activeAccount}
        nodeApiUrl={nodeSettings.nodeApiUrl}
        nodeEpoch={nodeEpoch}
        onAccountsStateChange={onAccountsStateChange}
        onMenuOpenChange={setAccountMenuOpen}
      />
      <NodeStatusButton
        nodeSettings={nodeSettings}
        onMenuOpenChange={setNodeMenuOpen}
        onNodeReachabilityChange={onNodeReachabilityChange}
        onOpenSettings={onOpenSettings}
        onResolvedNodeApiUrl={onResolvedNodeApiUrl}
      />
    </header>
  );
}
