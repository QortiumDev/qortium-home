import { Braces, Download, FolderOpen, Globe2, Pencil, Play, Settings as SettingsIcon, Square, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountsPanel } from './AccountsPanel';
import {
  getOpenDownloadedFileLabel,
  type AppUpdatesState,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import { getCoreRuntimeAction, getCoreRuntimeBlockedMessage, type CoreManagerState } from './coreManagerState';
import { DashboardCardHeader } from './DashboardCardActions';
import { getDashboardPinDisplay } from './dashboardPinDisplay';
import type { DashboardPin, DashboardPinDropPosition } from './dashboardPins';
import { getTranslationLanguage, t } from './i18n';
import {
  getOnChainCoreUpdateSummary,
  isOnChainCoreUpdateAttemptActive,
  type OnChainCoreUpdateController,
  type OnChainCoreUpdateState,
} from './onChainCoreUpdateState';
import {
  areReleaseTagsEqual,
  DetailList,
  formatReleaseTag,
  getCoreLatestRows,
  getCoreReleaseBusyAction,
  getCoreVersionRowValue,
  getHomeUpdateStatusText,
  getHomeVersionRowValue,
  getPreferredCoreReleaseTarget,
  LinkedValue,
  type DetailRow,
} from './releaseDisplay';
import type { SettingsSectionId } from './SettingsPage';

type DashboardPageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  appUpdates: AppUpdatesState;
  coreManager: CoreManagerState;
  dashboardPins: DashboardPin[];
  isLoadingAccounts: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onBrowseQdn: () => void;
  onOpenDashboardPin: (pin: DashboardPin) => void;
  onOpenCoreApiDocs: () => void;
  onOpenSettings: () => void;
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void;
  onRemoveDashboardPin: (pinId: string) => void;
  onRenameDashboardPin: (pinId: string, customLabel: string) => void;
  onReorderDashboardPin: (
    draggedPinId: string,
    targetPinId: string,
    dropPosition: DashboardPinDropPosition,
  ) => void;
  selectedAccountId: string | null;
  onAccountsStateChange: (accountsState: QortiumAccountsState) => void;
  onSelectedAccountChange: (accountId: string | null) => void;
};

function getCoreDashboardStatusText({
  coreMessage,
  onChainCoreUpdate,
  prereleaseUpdateAvailable,
  stableUpdateAvailable,
  status,
}: {
  coreMessage: CoreManagerState['message'];
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
}) {
  if (coreMessage?.kind === 'error') {
    return coreMessage.text;
  }

  if (onChainCoreUpdate.state === 'installing') {
    return t('core.onChain.installStarting');
  }

  const onChainUpdateSummary = getOnChainCoreUpdateSummary(onChainCoreUpdate);

  if (onChainUpdateSummary) {
    return onChainUpdateSummary;
  }

  if (!status) {
    return t('common.checking');
  }

  if (status.runtime.blocked) {
    return t('core.statusRuntimeBlocked');
  }

  if (!status.supported) {
    return t('common.unsupported');
  }

  if (!status.installed && status.runtime.running) {
    return status.runtime.owner === 'home'
      ? t('core.statusRunningFilesMissing')
      : t('core.statusLocalCoreDetected');
  }

  if (!status.installed) {
    return t('common.notInstalled');
  }

  if (!status.java.available && !status.runtime.running) {
    return t('core.statusJavaRequired');
  }

  if (stableUpdateAvailable || prereleaseUpdateAvailable) {
    return t('common.updateAvailable');
  }

  return t('common.upToDate');
}

function getCoreRows({
  coreMessage,
  onChainCoreUpdate,
  prereleaseUpdateAvailable,
  releases,
  stableUpdateAvailable,
  status,
}: {
  coreMessage: CoreManagerState['message'];
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  releases: QortiumCoreReleases | null;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
}): DetailRow[] {
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases,
    status,
  });
  const latestRelease = releaseTarget?.release ?? null;
  const installedVersion = status?.installed?.tagName ?? '';
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: getCoreDashboardStatusText({
        coreMessage,
        onChainCoreUpdate,
        prereleaseUpdateAvailable,
        stableUpdateAvailable,
        status,
      }),
    },
    {
      label: t('common.version'),
      value: getCoreVersionRowValue(status, 'dashboard-card__version-link'),
    },
  ];

  const runtimeBlockedMessage = getCoreRuntimeBlockedMessage(status);

  if (runtimeBlockedMessage) {
    rows.push({
      label: t('core.runtimeIssue'),
      value: runtimeBlockedMessage,
    });
  }

  const onChainStatus = onChainCoreUpdate.state === 'available' ? onChainCoreUpdate.status : null;

  rows.push(
    ...getCoreLatestRows({
      installedTagName: installedVersion,
      linkClassName: 'dashboard-card__version-link',
      onChain: onChainStatus,
      release: latestRelease,
    }),
  );

  return rows;
}

function ManagedCoreDashboardCard({
  coreManager,
  onChainCoreUpdate,
  onOpenSettingsSection,
}: {
  coreManager: CoreManagerState;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void;
}) {
  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const onChainInstallAttemptActive = !!onChainStatus && isOnChainCoreUpdateAttemptActive(onChainStatus);
  const showOnChainInstallAction =
    !!onChainStatus?.updateAvailable &&
    onChainStatus.autoUpdateMode !== 'INSTALL' &&
    !onChainInstallAttemptActive;
  const releaseTarget = getPreferredCoreReleaseTarget({
    releases: coreManager.releases,
    status: coreManager.status,
  });
  const releaseTargetUpdateAvailable =
    releaseTarget?.channel === 'stable'
      ? coreManager.stableUpdateAvailable
      : releaseTarget?.channel === 'prerelease'
        ? coreManager.prereleaseUpdateAvailable
        : false;
  const showReleaseUpdateAction =
    !showOnChainInstallAction &&
    !!coreManager.status?.installed &&
    !!releaseTarget &&
    releaseTargetUpdateAvailable;
  const releaseTargetBusyAction = getCoreReleaseBusyAction(releaseTarget?.channel);
  const language = getTranslationLanguage();
  const rows = useMemo(
    () =>
      getCoreRows({
        coreMessage: coreManager.message,
        onChainCoreUpdate: onChainCoreUpdate.status,
        prereleaseUpdateAvailable: coreManager.prereleaseUpdateAvailable,
        releases: coreManager.releases,
        stableUpdateAvailable: coreManager.stableUpdateAvailable,
        status: coreManager.status,
      }),
    [
      coreManager.message,
      coreManager.prereleaseUpdateAvailable,
      coreManager.releases,
      coreManager.stableUpdateAvailable,
      coreManager.status,
      language,
      onChainCoreUpdate.status,
    ],
  );
  const runtimeAction = getCoreRuntimeAction(coreManager);
  const hasAction = showOnChainInstallAction || showReleaseUpdateAction || !!runtimeAction;

  if (!coreManager.coreApi) {
    return null;
  }

  return (
    <section className="dashboard-card dashboard-card--core" aria-label={t('core.sectionTitle')}>
      <DashboardCardHeader
        isRefreshing={coreManager.isBusy || onChainCoreUpdate.isBusy}
        title={t('core.sectionTitle')}
        onOpenSettings={() => onOpenSettingsSection('core')}
        onRefresh={() => {
          void coreManager.refreshStatus();
          void onChainCoreUpdate.refreshStatus();
        }}
      />

      <DetailList className="dashboard-card__details" rows={rows} />

      {coreManager.progress && coreManager.progress.action !== 'idle' ? (
        <div className="core-manager__progress">
          <div className="core-manager__progress-bar" aria-hidden="true">
            <span style={{ width: `${coreManager.progressPercent ?? 100}%` }} />
          </div>
          <span className="core-manager__progress-text">
            {coreManager.progressPercent === null
              ? coreManager.progress.message
              : t('common.progressWithPercent', {
                  message: coreManager.progress.message,
                  percent: coreManager.progressPercent,
                })}
          </span>
        </div>
      ) : null}

      {hasAction ? (
        <div className="dashboard-card__actions">
          {showOnChainInstallAction ? (
            <button
              className="button"
              disabled={coreManager.isBusy || onChainCoreUpdate.isBusy || onChainInstallAttemptActive}
              type="button"
              onClick={onChainCoreUpdate.installUpdate}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {onChainCoreUpdate.status.state === 'installing' || onChainStatus?.installing
                ? t('common.installing')
                : t('core.installApprovedUpdate')}
            </button>
          ) : null}
          {showReleaseUpdateAction && releaseTarget ? (
            <button
              className="button"
              disabled={coreManager.isBusy}
              type="button"
              onClick={() => coreManager.installCore(releaseTarget.channel)}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {coreManager.busyAction === 'updating'
                ? t('common.updating')
                : coreManager.busyAction === releaseTargetBusyAction
                  ? t('common.installing')
                  : t('updates.installUpdate')}
            </button>
          ) : null}
          {runtimeAction ? (
            <button
              className="button button--secondary"
              disabled={runtimeAction.disabled}
              title={runtimeAction.title}
              type="button"
              onClick={runtimeAction.onClick}
            >
              {runtimeAction.kind === 'start' ? (
                <Play aria-hidden="true" size={18} strokeWidth={2} />
              ) : (
                <Square aria-hidden="true" size={18} strokeWidth={2} />
              )}
              {runtimeAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function getHomeUpdateRows(updates: AppUpdatesState) {
  const currentReleaseTag = formatReleaseTag(updates.environment?.currentVersion);
  const rows: DetailRow[] = [
    {
      label: t('common.status'),
      value: getHomeUpdateStatusText(updates),
    },
    {
      label: t('common.version'),
      value: getHomeVersionRowValue(updates.environment, 'dashboard-card__version-link'),
    },
  ];

  if (updates.result?.release && !areReleaseTagsEqual(updates.result.release.tagName, currentReleaseTag)) {
    rows.push({
      label: t('common.latestGithub'),
      value: (
        <LinkedValue className="dashboard-card__version-link" url={updates.result.release.htmlUrl}>
          {updates.result.release.tagName}
        </LinkedValue>
      ),
    });
  }

  return rows;
}

function HomeUpdateDashboardCard({
  updates,
  onOpenSettingsSection,
}: {
  updates: AppUpdatesState;
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void;
}) {
  const rows = getHomeUpdateRows(updates);
  const showDownloadedAction = !!updates.downloadedUpdate?.canOpen;
  const showDownloadAction =
    !showDownloadedAction && updates.updateAvailable && !!updates.result?.asset && !!updates.result.release;
  const hasAction = showDownloadAction || showDownloadedAction;

  return (
    <section className="dashboard-card dashboard-card--updates" aria-label={t('common.appName')}>
      <DashboardCardHeader
        isRefreshing={updates.isChecking}
        title={t('common.appName')}
        onOpenSettings={() => onOpenSettingsSection('home')}
        onRefresh={updates.checkForUpdates}
      />

      <DetailList className="dashboard-card__details" rows={rows} />

      <AppUpdateProgress progress={updates.downloadProgress} />

      {hasAction ? (
        <div className="dashboard-card__actions">
          {showDownloadAction ? (
            <button
              className="button"
              disabled={updates.isChecking || updates.isDownloading}
              type="button"
              onClick={updates.downloadUpdate}
            >
              <Download aria-hidden="true" size={18} strokeWidth={2} />
              {updates.isDownloading ? t('common.downloading') : t('updates.downloadUpdate')}
            </button>
          ) : null}
          {showDownloadedAction ? (
            <button
              className="button"
              disabled={updates.isChecking || updates.isDownloading}
              type="button"
              onClick={updates.openDownloadedUpdate}
            >
              <FolderOpen aria-hidden="true" size={18} strokeWidth={2} />
              {getOpenDownloadedFileLabel(updates.updatePlatform)}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const PIN_DRAG_START_MIN_DISTANCE_PX = 8;
const PIN_LONG_PRESS_MS = 500;

type PinContextMenuState = { pinId: string; x: number; y: number } | null;

function DashboardPins({
  pins,
  onOpenPin,
  onRemovePin,
  onRenamePin,
  onReorderPin,
}: {
  pins: DashboardPin[];
  onOpenPin: (pin: DashboardPin) => void;
  onRemovePin: (pinId: string) => void;
  onRenamePin: (pinId: string, customLabel: string) => void;
  onReorderPin: (draggedPinId: string, targetPinId: string, dropPosition: DashboardPinDropPosition) => void;
}) {
  const [contextMenu, setContextMenu] = useState<PinContextMenuState>(null);
  const [draggedPinId, setDraggedPinId] = useState<string | null>(null);
  const [renamingPinId, setRenamingPinId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const pinElementsRef = useRef(new Map<string, HTMLLIElement>());
  const dragStateRef = useRef<{
    hasReordered: boolean;
    pinId: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressedClickPinIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Dismiss the context menu on outside pointerdown or Escape.
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
    if (renamingPinId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingPinId]);

  // Move focus into the context menu when it opens, for keyboard / screen-reader users.
  useEffect(() => {
    if (contextMenu) {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('.dashboard-pin__menu-item')?.focus();
    }
  }, [contextMenu]);

  // Cancel a pending long-press timer when unmounting so it can't run after disposal.
  useEffect(() => () => clearLongPressTimer(), []);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function clearDragState() {
    dragStateRef.current = null;
    setDraggedPinId(null);
    clearLongPressTimer();
  }

  // Clear the click-suppression flag after the artifact click that follows a drag /
  // long-press has been dispatched, so a later genuine tap is never swallowed.
  function scheduleSuppressionClear() {
    window.setTimeout(() => {
      suppressedClickPinIdRef.current = null;
    }, 0);
  }

  function handlePointerCancel() {
    clearDragState();
    scheduleSuppressionClear();
  }

  function openContextMenuAt(pinId: string, clientX: number, clientY: number) {
    const rootFontSizePx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const menuWidth = 12 * rootFontSizePx;
    const menuHeight = 6 * rootFontSizePx;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

    setContextMenu({
      pinId,
      x: Math.max(margin, Math.min(clientX, maxX)),
      y: Math.max(margin, Math.min(clientY, maxY)),
    });
  }

  function getReorderTarget(pointerClientX: number, pointerClientY: number, sourcePinId: string) {
    const currentIndex = pins.findIndex((pin) => pin.id === sourcePinId);

    if (currentIndex === -1 || pins.length < 2) {
      return null;
    }

    const pinsWithoutDragged = pins.filter((pin) => pin.id !== sourcePinId);
    let target: { dropPosition: DashboardPinDropPosition; pinId: string } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const pin of pinsWithoutDragged) {
      const element = pinElementsRef.current.get(pin.id);

      if (!element) {
        continue;
      }

      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const distance = Math.hypot(pointerClientX - centerX, pointerClientY - centerY);

      if (distance < bestDistance) {
        bestDistance = distance;
        target = { dropPosition: pointerClientX < centerX ? 'before' : 'after', pinId: pin.id };
      }
    }

    if (!target) {
      return null;
    }

    const targetIndex = pinsWithoutDragged.findIndex((pin) => pin.id === target?.pinId);
    const insertIndex = target.dropPosition === 'after' ? targetIndex + 1 : targetIndex;

    if (insertIndex === currentIndex) {
      return null;
    }

    return target;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLLIElement>, pinId: string) {
    if (renamingPinId) {
      return;
    }

    // A pointerdown while the menu is open just dismisses it (first click closes,
    // it does not also open/drag the tile).
    if (contextMenu) {
      suppressedClickPinIdRef.current = pinId;
      setContextMenu(null);
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    // Ignore a second simultaneous pointer so it can't hijack an in-progress drag.
    if (dragStateRef.current && dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    if ((event.target as HTMLElement).closest('.dashboard-pin__rename-input')) {
      return;
    }

    const { clientX, clientY } = event;

    dragStateRef.current = {
      hasReordered: false,
      pinId,
      pointerId: event.pointerId,
      startX: clientX,
      startY: clientY,
    };
    setDraggedPinId(pinId);
    event.currentTarget.setPointerCapture(event.pointerId);

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const dragState = dragStateRef.current;

      if (dragState && dragState.pinId === pinId && !dragState.hasReordered) {
        suppressedClickPinIdRef.current = pinId;
        clearDragState();
        openContextMenuAt(pinId, clientX, clientY);
      }
    }, PIN_LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLLIElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (
      !dragState.hasReordered &&
      Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) <
        PIN_DRAG_START_MIN_DISTANCE_PX
    ) {
      return;
    }

    clearLongPressTimer();

    const reorderTarget = getReorderTarget(event.clientX, event.clientY, dragState.pinId);

    if (!reorderTarget) {
      return;
    }

    dragState.hasReordered = true;
    onReorderPin(dragState.pinId, reorderTarget.pinId, reorderTarget.dropPosition);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLLIElement>, pin: DashboardPin) {
    const dragState = dragStateRef.current;
    const isMyPointer = !!dragState && dragState.pointerId === event.pointerId;
    const reordered = isMyPointer && dragState.hasReordered;
    // A clean tap (gesture started on this tile, no reorder, not renaming) opens the pin
    // here on pointerup: the browser does not reliably fire a click after the pointer
    // capture used for drag-reorder, so we must not depend on the tile button's onClick.
    const isTap = isMyPointer && !reordered && !renamingPinId;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (reordered || isTap) {
      // Swallow the click the browser may still synthesize for this pointer.
      suppressedClickPinIdRef.current = pin.id;
    }

    clearDragState();
    scheduleSuppressionClear();

    if (isTap) {
      onOpenPin(pin);
    }
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLLIElement>, pinId: string) {
    // While renaming, leave the native context menu intact (e.g. paste into the input).
    if (renamingPinId) {
      return;
    }

    event.preventDefault();
    clearDragState();
    openContextMenuAt(pinId, event.clientX, event.clientY);
  }

  function handleOpen(pin: DashboardPin) {
    if (suppressedClickPinIdRef.current === pin.id) {
      suppressedClickPinIdRef.current = null;
      return;
    }

    onOpenPin(pin);
  }

  function startRename(pinId: string, currentLabel: string) {
    setContextMenu(null);
    setRenameValue(currentLabel);
    setRenamingPinId(pinId);
  }

  function commitRename() {
    if (!renamingPinId) {
      return;
    }

    // Skip persisting if the pin disappeared (e.g. removed in another window) while editing.
    if (pins.some((pin) => pin.id === renamingPinId)) {
      onRenamePin(renamingPinId, renameValue);
    }

    setRenamingPinId(null);
    setRenameValue('');
  }

  function cancelRename() {
    setRenamingPinId(null);
    setRenameValue('');
  }

  const contextMenuPin = contextMenu ? pins.find((pin) => pin.id === contextMenu.pinId) ?? null : null;
  const contextMenuLabel = contextMenuPin ? getDashboardPinDisplay(contextMenuPin).shortLabel : '';

  return (
    <section className="dashboard-pins" aria-label={t('dashboard.pins')}>
      <h2 className="dashboard-pins__title">{t('dashboard.pins')}</h2>
      <ul className="dashboard-pins__list">
        {pins.map((pin) => {
          const display = getDashboardPinDisplay(pin);
          const isRenaming = renamingPinId === pin.id;

          return (
            <li
              className={`dashboard-pin${draggedPinId === pin.id ? ' dashboard-pin--dragging' : ''}`}
              key={pin.id}
              ref={(element) => {
                if (element) {
                  pinElementsRef.current.set(pin.id, element);
                } else {
                  pinElementsRef.current.delete(pin.id);
                }
              }}
              onPointerDown={(event) => handlePointerDown(event, pin.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handlePointerUp(event, pin)}
              onPointerCancel={handlePointerCancel}
              onLostPointerCapture={handlePointerCancel}
              onContextMenu={(event) => handleContextMenu(event, pin.id)}
            >
              <button
                className="dashboard-pin__tile"
                title={t('common.openItem', { target: display.shortLabel })}
                type="button"
                aria-label={t('common.openItem', { target: display.shortLabel })}
                onClick={() => handleOpen(pin)}
                onKeyDown={(event) => {
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    openContextMenuAt(pin.id, bounds.left, bounds.bottom);
                  }
                }}
              >
                <display.Icon aria-hidden="true" size={28} strokeWidth={2} />
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    className="dashboard-pin__rename-input"
                    type="text"
                    value={renameValue}
                    aria-label={t('dashboard.renamePinLabel', { label: display.shortLabel })}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        commitRename();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRename();
                      }
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <span className="dashboard-pin__label">{display.shortLabel}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {contextMenu && contextMenuPin ? (
        <div
          className="dashboard-pin__menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={t('dashboard.pinMenuLabel')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="dashboard-pin__menu-item"
            role="menuitem"
            type="button"
            onClick={() => startRename(contextMenuPin.id, contextMenuLabel)}
          >
            <Pencil aria-hidden="true" size={16} strokeWidth={2} />
            {t('dashboard.renamePin')}
          </button>
          <button
            className="dashboard-pin__menu-item dashboard-pin__menu-item--danger"
            role="menuitem"
            type="button"
            onClick={() => {
              onRemovePin(contextMenuPin.id);
              setContextMenu(null);
            }}
          >
            <X aria-hidden="true" size={16} strokeWidth={2} />
            {t('common.remove')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function DashboardPage({
  accountsError,
  accountsState,
  appUpdates,
  coreManager,
  dashboardPins,
  isLoadingAccounts,
  nodeApiUrl,
  nodeEpoch,
  onChainCoreUpdate,
  onBrowseQdn,
  onOpenDashboardPin,
  onOpenCoreApiDocs,
  onOpenSettings,
  onOpenSettingsSection,
  onRemoveDashboardPin,
  onRenameDashboardPin,
  onReorderDashboardPin,
  onAccountsStateChange,
  onSelectedAccountChange,
  selectedAccountId,
}: DashboardPageProps) {
  const hasManagedCore = !!window.qortiumHome.core;

  return (
    <div className="dashboard-page">
      <header className="dashboard-page__header">
        <h1>{t('common.dashboard')}</h1>
      </header>

      {dashboardPins.length > 0 ? (
        <DashboardPins
          pins={dashboardPins}
          onOpenPin={onOpenDashboardPin}
          onRemovePin={onRemoveDashboardPin}
          onRenamePin={onRenameDashboardPin}
          onReorderPin={onReorderDashboardPin}
        />
      ) : null}

      <div className="dashboard-page__primary-action">
        <button className="button button--primary" type="button" onClick={onBrowseQdn}>
          <Globe2 aria-hidden="true" size={18} strokeWidth={2} />
          {t('explorer.browseQdn')}
        </button>
        <button className="button" type="button" onClick={onOpenCoreApiDocs}>
          <Braces aria-hidden="true" size={18} strokeWidth={2} />
          {t('explorer.coreApi')}
        </button>
        <button className="button" type="button" onClick={onOpenSettings}>
          <SettingsIcon aria-hidden="true" size={18} strokeWidth={2} />
          {t('common.settings')}
        </button>
      </div>

      <section className="dashboard-card dashboard-card--accounts" aria-label={t('account.title')}>
        <div className="dashboard-card__header">
          <h2 className="dashboard-card__title">{t('account.title')}</h2>
        </div>
        <AccountsPanel
          accountsError={accountsError}
          accountsState={accountsState}
          isLoadingAccounts={isLoadingAccounts}
          nodeApiUrl={nodeApiUrl}
          nodeEpoch={nodeEpoch}
          selectedAccountId={selectedAccountId}
          onAccountsStateChange={onAccountsStateChange}
          onSelectedAccountChange={onSelectedAccountChange}
        />
      </section>

      <div className={`dashboard-page__grid${hasManagedCore ? '' : ' dashboard-page__grid--single'}`}>
        {hasManagedCore ? (
          <ManagedCoreDashboardCard
            coreManager={coreManager}
            onChainCoreUpdate={onChainCoreUpdate}
            onOpenSettingsSection={onOpenSettingsSection}
          />
        ) : null}
        <HomeUpdateDashboardCard updates={appUpdates} onOpenSettingsSection={onOpenSettingsSection} />
      </div>
    </div>
  );
}
