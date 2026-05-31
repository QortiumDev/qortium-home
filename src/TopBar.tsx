import { ArrowRight, ChevronLeft, ChevronRight, Globe2, Plus, X } from 'lucide-react';
import type { FormEvent, MouseEvent, PointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeStatusButton } from './NodeStatusButton';
import { Popover } from './components/Popover';
import type { AppRoute } from './routes';
import { parseAppAddress } from './routes';

type TopBarProps = {
  activeAccount: QortiumAccountSummary | null;
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  currentRoute: AppRoute;
  historyEntries: AppRoute[];
  historyIndex: number;
  nodeSettings: QortiumNodeSettings;
  tabs: BrowserTabSummary[];
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoToHistoryIndex: (index: number) => void;
  onNavigate: (route: AppRoute) => void;
  onOpenSettings: () => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, dropPosition: TabDropPosition) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSelectTab: (tabId: string) => void;
};

type TabDropPosition = 'after' | 'before';

type BrowserTabSummary = {
  id: string;
  label: string;
};

type HistoryButtonProps = {
  canNavigate: boolean;
  direction: 'back' | 'forward';
  historyEntries: AppRoute[];
  historyIndex: number;
  onJump: (index: number) => void;
  onStep: () => void;
};

type HistoryMenuItem = {
  entry: AppRoute;
  index: number;
};

const accountProfileCache = new Map<string, Promise<QortiumAccountProfile>>();
const ADDRESS_SCHEME_SUGGESTIONS = [
  {
    description: 'QDN',
    value: 'qdn://',
  },
  {
    description: 'Core',
    value: 'core://',
  },
  {
    description: 'Home',
    value: 'home://dashboard',
  },
  {
    description: 'Settings',
    value: 'home://settings',
  },
];

function formatHistoryEntry(entry: AppRoute) {
  if (entry.kind === 'dashboard') {
    return 'Dashboard';
  }

  if (entry.kind === 'settings') {
    return 'Settings';
  }

  return entry.displayUrl;
}

function getAccountProfileCacheKey(account: QortiumAccountSummary, nodeApiUrl: string) {
  return `${nodeApiUrl}:${account.id}:${account.address}:${account.label}`;
}

function getAccountProfile(account: QortiumAccountSummary, nodeApiUrl: string) {
  const cacheKey = getAccountProfileCacheKey(account, nodeApiUrl);
  let profileRequest = accountProfileCache.get(cacheKey);

  if (!profileRequest) {
    profileRequest = window.qortiumHome.accounts.getProfile(account.id).catch((error) => {
      accountProfileCache.delete(cacheKey);
      throw error;
    });
    accountProfileCache.set(cacheKey, profileRequest);
  }

  return profileRequest;
}

function getDisplayInitial(value: string) {
  const character = value.trim().charAt(0);

  return character ? character.toUpperCase() : '?';
}

function getAddressSchemeSuggestion(value: string) {
  const input = value.trim().toLowerCase();

  if (!input) {
    return null;
  }

  return (
    ADDRESS_SCHEME_SUGGESTIONS.find((suggestion) => {
      const suggestionValue = suggestion.value.toLowerCase();
      const scheme = suggestionValue.slice(0, suggestionValue.indexOf(':'));

      return (
        input !== suggestionValue &&
        (suggestionValue.startsWith(input) || scheme.startsWith(input))
      );
    }) ?? null
  );
}

function getAccountTooltip(account: QortiumAccountSummary, profile: QortiumAccountProfile | null) {
  return [
    profile?.name ?? '',
    profile?.address ?? account.address,
    profile?.label ?? account.label,
  ].filter(Boolean).join('\n');
}

function AccountChip({
  account,
  nodeApiUrl,
}: {
  account: QortiumAccountSummary | null;
  nodeApiUrl: string;
}) {
  const [profile, setProfile] = useState<QortiumAccountProfile | null>(null);
  const [hasAvatarError, setHasAvatarError] = useState(false);

  useEffect(() => {
    let isDisposed = false;

    setProfile(null);
    setHasAvatarError(false);

    if (!account) {
      return () => {
        isDisposed = true;
      };
    }

    getAccountProfile(account, nodeApiUrl)
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
  }, [account, nodeApiUrl]);

  if (!account) {
    return null;
  }

  const displayName = profile?.name ?? account.label;
  const avatarUrl = profile?.avatarUrl;
  const showAvatar = !!avatarUrl && !hasAvatarError;

  return (
    <div
      className="account-chip"
      title={getAccountTooltip(account, profile)}
      aria-label="Selected tab account"
    >
      {showAvatar ? (
        <img
          className="account-chip__avatar"
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          onError={() => setHasAvatarError(true)}
        />
      ) : (
        <span className="account-chip__fallback" aria-hidden="true">
          {getDisplayInitial(displayName)}
        </span>
      )}
      <span className="sr-only">{displayName}</span>
    </div>
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
  onStep,
}: HistoryButtonProps) {
  const label = direction === 'back' ? 'Back' : 'Forward';
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight;
  const items = useMemo(
    () => getHistoryItems(direction, historyEntries, historyIndex),
    [direction, historyEntries, historyIndex],
  );

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>, open: () => void) {
    event.preventDefault();

    if (canNavigate) {
      open();
    }
  }

  return (
    <Popover
      className="top-bar__history"
      contentClassName={`top-bar__history-popover top-bar__history-popover--${direction}`}
      contentId={`top-bar-${direction}-history`}
      contentLabel={`${label} history`}
      contentRole="menu"
      renderTrigger={({ close, contentId, isOpen, open }) => (
        <button
          className="icon-button top-bar__history-button"
          disabled={!canNavigate}
          title={`${label} (right-click for history)`}
          type="button"
          aria-controls={isOpen ? contentId : undefined}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={() => {
            close();
            onStep();
          }}
          onContextMenu={(event) => handleContextMenu(event, open)}
        >
          <Icon aria-hidden="true" size={20} strokeWidth={2} />
          <span className="sr-only">{label}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="top-bar__history-menu">
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

function BrowserTabs({
  activeTabId,
  onAddTab,
  onCloseTab,
  onReorderTab,
  onSelectTab,
  tabs,
}: {
  activeTabId: string;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, dropPosition: TabDropPosition) => void;
  onSelectTab: (tabId: string) => void;
  tabs: BrowserTabSummary[];
}) {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const dragStateRef = useRef<{
    hasReordered: boolean;
    pointerId: number;
    tabId: string;
  } | null>(null);
  const suppressedClickTabIdRef = useRef<string | null>(null);
  const tabElementsRef = useRef(new Map<string, HTMLDivElement>());

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

    const reorderTarget = getReorderTarget(event.clientX, dragState.tabId);

    if (!reorderTarget) {
      return;
    }

    dragState.hasReordered = true;
    onReorderTab(dragState.tabId, reorderTarget.targetTabId, reorderTarget.dropPosition);
  }

  return (
    <div className="top-bar__tabs">
      <div
        className="top-bar__tab-list"
        role="tablist"
        aria-label="Browser tabs"
        onDoubleClick={(event) => {
          if (event.currentTarget === event.target) {
            onAddTab();
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

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
              onPointerUp={(event) => clearDragState(event, true)}
            >
              <button
                className="top-bar__tab-select"
                role="tab"
                type="button"
                title={tab.label}
                aria-selected={isActive}
                onClick={(event) => {
                  if (suppressedClickTabIdRef.current === tab.id) {
                    suppressedClickTabIdRef.current = null;
                    event.preventDefault();
                    return;
                  }

                  onSelectTab(tab.id);
                }}
              >
                <span className="top-bar__tab-label">{tab.label}</span>
              </button>
              <button
                className="top-bar__tab-close"
                type="button"
                title={`Close ${tab.label}`}
                aria-label={`Close ${tab.label}`}
                onClick={() => onCloseTab(tab.id)}
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="icon-button top-bar__new-tab" title="New tab" type="button" onClick={onAddTab}>
        <Plus aria-hidden="true" size={20} strokeWidth={2} />
        <span className="sr-only">New tab</span>
      </button>
    </div>
  );
}

export function TopBar({
  activeAccount,
  activeTabId,
  canGoBack,
  canGoForward,
  currentRoute,
  historyEntries,
  historyIndex,
  nodeSettings,
  tabs,
  onAddTab,
  onCloseTab,
  onGoBack,
  onGoForward,
  onGoToHistoryIndex,
  onNavigate,
  onOpenSettings,
  onReorderTab,
  onResolvedNodeApiUrl,
  onSelectTab,
}: TopBarProps) {
  const [addressValue, setAddressValue] = useState('');
  const [addressError, setAddressError] = useState('');
  const addressSuggestion = getAddressSchemeSuggestion(addressValue);

  useEffect(() => {
    setAddressValue(currentRoute.displayUrl);
    setAddressError('');
  }, [activeTabId, currentRoute]);

  function applyAddressSuggestion() {
    if (!addressSuggestion) {
      return;
    }

    setAddressValue(addressSuggestion.value);
    setAddressError('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (addressSuggestion) {
      applyAddressSuggestion();
      return;
    }

    const parsedUrl = parseAppAddress(addressValue);

    if (!parsedUrl.success) {
      setAddressError(parsedUrl.message);
      return;
    }

    setAddressError('');
    setAddressValue(parsedUrl.route.displayUrl);
    onNavigate(parsedUrl.route);
  }

  return (
    <header className="top-bar">
      <BrowserTabs
        activeTabId={activeTabId}
        tabs={tabs}
        onAddTab={onAddTab}
        onCloseTab={onCloseTab}
        onReorderTab={onReorderTab}
        onSelectTab={onSelectTab}
      />
      <form className="top-bar__address-form" onSubmit={handleSubmit}>
        <HistoryButton
          canNavigate={canGoBack}
          direction="back"
          historyEntries={historyEntries}
          historyIndex={historyIndex}
          onJump={onGoToHistoryIndex}
          onStep={onGoBack}
        />
        <HistoryButton
          canNavigate={canGoForward}
          direction="forward"
          historyEntries={historyEntries}
          historyIndex={historyIndex}
          onJump={onGoToHistoryIndex}
          onStep={onGoForward}
        />
        <label className="sr-only" htmlFor="browser-address">
          Address
        </label>
        <div className="top-bar__address-control">
          <Globe2 aria-hidden="true" className="top-bar__address-icon" size={20} strokeWidth={2} />
          <input
            autoComplete="off"
            className="top-bar__address-input"
            id="browser-address"
            placeholder="qdn://APP, core://admin/status, or home://dashboard"
            spellCheck={false}
            type="text"
            value={addressValue}
            onChange={(event) => {
              setAddressValue(event.target.value);
              setAddressError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Tab' && addressSuggestion) {
                event.preventDefault();
                applyAddressSuggestion();
              }
            }}
          />
        </div>
        <button className="icon-button top-bar__go-button" title="Load address" type="submit">
          <ArrowRight aria-hidden="true" size={20} strokeWidth={2} />
          <span className="sr-only">Load address</span>
        </button>
        {addressSuggestion ? (
          <button
            className="top-bar__address-suggestion"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={applyAddressSuggestion}
          >
            <span className="top-bar__address-suggestion-value">{addressSuggestion.value}</span>
            <span className="top-bar__address-suggestion-label">{addressSuggestion.description}</span>
          </button>
        ) : null}
        {addressError ? <p className="top-bar__error">{addressError}</p> : null}
      </form>
      <AccountChip account={activeAccount} nodeApiUrl={nodeSettings.nodeApiUrl} />
      <NodeStatusButton
        nodeSettings={nodeSettings}
        onOpenSettings={onOpenSettings}
        onResolvedNodeApiUrl={onResolvedNodeApiUrl}
      />
    </header>
  );
}
