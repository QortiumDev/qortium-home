import { Braces, Download, FolderOpen, Globe2, Pencil, Play, Settings as SettingsIcon, Square, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccountsPanel } from './AccountsPanel';
import type { AppIconResolution } from './appIconUtils';
import { getAppIconResolution } from './appIconUtils';
import { AppIcon } from './AppIcon';
import {
  getOpenDownloadedFileLabel,
  type AppUpdatesState,
} from './appUpdateState';
import { AppUpdateProgress } from './AppUpdateProgress';
import { getCoreRuntimeAction, getCoreRuntimeBlockedMessage, type CoreManagerState } from './coreManagerState';
import { NodeModeSelect } from './NodeConnection';
import { I2pRouterButton, TransportModeSelect } from './TransportControls';
import { DashboardCardHeader } from './DashboardCardActions';
import { useI2pConnections } from './i2pState';
import { useI2pdManager } from './i2pdManagerState';
import { getDashboardPinDisplay } from './dashboardPinDisplay';
import type { DashboardPin, DashboardPinDropPosition } from './dashboardPins';
import { reorderDashboardPins } from './dashboardPins';
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
import { useMenuKeyboard } from './useMenuKeyboard';

type DashboardPageProps = {
  accountsError: string;
  accountsState: QortiumAccountsState;
  appUpdates: AppUpdatesState;
  connectionRefreshEpoch: number;
  coreManager: CoreManagerState;
  dashboardPins: DashboardPin[];
  isLoadingAccounts: boolean;
  nodeApiUrl: string;
  nodeEpoch: number;
  nodeSettings: QortiumNodeSettings;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
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
  transports,
}: {
  coreMessage: CoreManagerState['message'];
  onChainCoreUpdate: OnChainCoreUpdateState;
  prereleaseUpdateAvailable: boolean;
  releases: QortiumCoreReleases | null;
  stableUpdateAvailable: boolean;
  status: QortiumCoreStatus | null;
  transports: string;
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
    {
      label: t('connections.title'),
      value: transports,
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
  connectionRefreshEpoch,
  nodeApiUrl,
  nodeSettings,
  onChainCoreUpdate,
  onOpenSettingsSection,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
}: {
  coreManager: CoreManagerState;
  connectionRefreshEpoch: number;
  nodeApiUrl: string;
  nodeSettings: QortiumNodeSettings;
  onChainCoreUpdate: OnChainCoreUpdateController;
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void;
  onResolvedNodeApiUrl: (nodeApiUrl: string) => void;
  onSaveNodeSettings: (request: QortiumNodeSettingsRequest) => Promise<QortiumNodeSettings>;
}) {
  const connections = useI2pConnections(nodeApiUrl, connectionRefreshEpoch);
  const transports = connections.status
    ? connections.status.transport.effectiveTransports.join(', ')
    : connections.isUnavailable
      ? t('common.unavailable')
      : t('common.checking');
  const onChainStatus =
    onChainCoreUpdate.status.state === 'available' ? onChainCoreUpdate.status.status : null;
  const onChainInstallAttemptActive = !!onChainStatus && isOnChainCoreUpdateAttemptActive(onChainStatus);
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
  // Mirror the Settings → Qortium Core gating so the dashboard tile is never a
  // dead-end when Core isn't installed: offer Install Java first, then Install Core
  // (fresh install OR update), and only surface Start/Stop once Java is present.
  const showJavaAction = coreManager.canInstallJava;
  const showOnChainInstallAction =
    !showJavaAction &&
    !!onChainStatus?.updateAvailable &&
    onChainStatus.autoUpdateMode !== 'INSTALL' &&
    !onChainInstallAttemptActive;
  const showCoreInstallAction =
    !showJavaAction &&
    !showOnChainInstallAction &&
    !!releaseTarget &&
    (!coreManager.status?.installed || releaseTargetUpdateAvailable);
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
        transports,
      }),
    [
      coreManager.message,
      coreManager.prereleaseUpdateAvailable,
      coreManager.releases,
      coreManager.stableUpdateAvailable,
      coreManager.status,
      language,
      onChainCoreUpdate.status,
      transports,
    ],
  );
  const runtimeAction = getCoreRuntimeAction(coreManager, showJavaAction);

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
          <span className="core-manager__progress-text" role="status" aria-live="polite">
            {coreManager.progressPercent === null
              ? coreManager.progress.message
              : t('common.progressWithPercent', {
                  message: coreManager.progress.message,
                  percent: coreManager.progressPercent,
                })}
          </span>
        </div>
      ) : null}

      <div className="dashboard-card__actions">
        <NodeModeSelect
          className="field__input dashboard-card__node-mode"
          nodeSettings={nodeSettings}
          onResolvedNodeApiUrl={onResolvedNodeApiUrl}
          onSaveNodeSettings={onSaveNodeSettings}
        />
        {showJavaAction ? (
          <button
            className="button"
            disabled={coreManager.isBusy}
            type="button"
            onClick={coreManager.installJava}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            {coreManager.busyAction === 'installing-java' ? t('common.installing') : t('core.installJava')}
          </button>
        ) : null}
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
        {showCoreInstallAction && releaseTarget ? (
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
                : coreManager.status?.installed
                  ? t('updates.installUpdate')
                  : t('core.installCore')}
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
  canManageTransports,
  connectionRefreshEpoch,
  isManagedNode,
  nodeApiUrl,
  updates,
  onOpenSettingsSection,
}: {
  canManageTransports: boolean;
  connectionRefreshEpoch: number;
  isManagedNode: boolean;
  nodeApiUrl: string;
  updates: AppUpdatesState;
  onOpenSettingsSection: (sectionId: SettingsSectionId) => void;
}) {
  const connections = useI2pConnections(nodeApiUrl, connectionRefreshEpoch);
  const i2pdManager = useI2pdManager(isManagedNode);
  const rows = getHomeUpdateRows(updates);
  const showDownloadedAction = !!updates.downloadedUpdate?.canOpen;
  const showDownloadAction =
    !showDownloadedAction && updates.updateAvailable && !!updates.result?.asset && !!updates.result.release;
  const showRouter = i2pdManager.supported && isManagedNode;
  const hasActions = canManageTransports || showRouter || showDownloadAction || showDownloadedAction;

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

      {hasActions ? (
      <div className="dashboard-card__actions">
        {canManageTransports ? (
          <TransportModeSelect
            className="field__input dashboard-card__node-mode"
            connections={connections}
            isManagedNode={isManagedNode}
            manager={i2pdManager}
          />
        ) : null}
        <I2pRouterButton connections={connections} isManagedNode={isManagedNode} manager={i2pdManager} />
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
const PIN_TILE_REM = 4.5;
const PIN_GAP_PX = 10;

type PinContextMenuState = { pinId: string; x: number; y: number } | null;

// Chooses how many columns to render so that, when the tiles wrap, the rows are
// balanced (e.g. 5 tiles become 3 + 2 rather than 4 + 1) while never exceeding
// the number of columns that fit the available width. The list is then capped to
// exactly that many tiles wide and centered, so each row — including the last —
// is centered horizontally.
function getBalancedColumnCount(containerWidth: number, count: number, tilePx: number, gapPx: number): number {
  if (count <= 1) {
    return Math.max(1, count);
  }

  const maxColumns = Math.max(1, Math.floor((containerWidth + gapPx) / (tilePx + gapPx)));
  const columnsThatFit = Math.min(maxColumns, count);
  const rows = Math.ceil(count / columnsThatFit);

  return Math.ceil(count / rows);
}

function clampValue(value: number, a: number, b: number): number {
  const min = Math.min(a, b);
  const max = Math.max(a, b);

  return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function DashboardPins({
  pins,
  nodeApiUrl,
  nodeEpoch,
  onOpenPin,
  onRemovePin,
  onRenamePin,
  onReorderPin,
}: {
  pins: DashboardPin[];
  nodeApiUrl: string;
  nodeEpoch: number;
  onOpenPin: (pin: DashboardPin) => void;
  onRemovePin: (pinId: string) => void;
  onRenamePin: (pinId: string, customLabel: string) => void;
  onReorderPin: (draggedPinId: string, targetPinId: string, dropPosition: DashboardPinDropPosition) => void;
}) {
  const [contextMenu, setContextMenu] = useState<PinContextMenuState>(null);
  const [draggedPinId, setDraggedPinId] = useState<string | null>(null);
  const [renamingPinId, setRenamingPinId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // While a drag is in progress we render this working order and animate towards
  // it, committing the final order to the parent only once, on drop. `null` means
  // no drag is active and we render the persisted `pins` prop directly.
  const [workingPins, setWorkingPins] = useState<DashboardPin[] | null>(null);
  const [listWidth, setListWidth] = useState(0);

  const renderPins = workingPins ?? pins;

  const pinElementsRef = useRef(new Map<string, HTMLLIElement>());
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dragStateRef = useRef<{
    grabOffsetX: number;
    grabOffsetY: number;
    hasReordered: boolean;
    listRect: { bottom: number; left: number; right: number; top: number } | null;
    pinId: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  // Translate currently applied to the dragged tile, so each move can recover the
  // tile's untransformed layout position (which shifts as the grid reorders).
  const appliedTranslateRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Tile rects captured just before a reorder, used to FLIP-animate the displaced
  // (non-dragged) tiles from their old slots to their new ones.
  const flipPrevRectsRef = useRef(new Map<string, DOMRect>());
  // Pending FLIP cleanup rAF per tile, so a stale callback from an earlier reorder
  // can be cancelled before it wipes a transform set by a newer one.
  const flipRafRef = useRef(new Map<string, number>());
  // Guards against stacking multiple reorders before React commits the previous
  // one (the DOM the next move reads would otherwise be stale).
  const pendingReorderRef = useRef(false);
  const suppressedClickPinIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuFocusTargetRef = useRef<HTMLElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const iconResolutions = useMemo(() => {
    const resolutions = new Map<string, AppIconResolution | null>();

    for (const pin of renderPins) {
      resolutions.set(pin.id, getAppIconResolution(pin.displayUrl, nodeApiUrl, nodeEpoch));
    }

    return resolutions;
  }, [renderPins, nodeApiUrl, nodeEpoch]);

  // Measure the section (not the list) so the list's derived max-width can't feed
  // back into the measurement and oscillate.
  useLayoutEffect(() => {
    const element = sectionRef.current;

    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setListWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const { listMaxWidth } = useMemo(() => {
    const count = renderPins.length;

    if (listWidth <= 0 || count <= 1) {
      return { listMaxWidth: undefined as number | undefined };
    }

    const rootFontSizePx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const tilePx = PIN_TILE_REM * rootFontSizePx;
    const columns = getBalancedColumnCount(listWidth, count, tilePx, PIN_GAP_PX);

    return { listMaxWidth: columns * tilePx + (columns - 1) * PIN_GAP_PX };
  }, [listWidth, renderPins.length]);

  // After each reorder: FLIP the displaced tiles from their previous slots and
  // re-glue the dragged tile to the pointer at its new slot (its inline transform
  // persists across the re-render, so its layout shift would otherwise show).
  useLayoutEffect(() => {
    const drag = dragStateRef.current;

    if (!drag) {
      return;
    }

    const previousRects = flipPrevRectsRef.current;

    if (previousRects.size > 0) {
      const rafIds = flipRafRef.current;

      if (prefersReducedMotion()) {
        // Honour the user's motion preference explicitly: drop the tiles straight
        // into their final slots with no slide (and no leftover inline transform).
        previousRects.forEach((_, pinId) => {
          if (pinId === drag.pinId) {
            return;
          }

          const element = pinElementsRef.current.get(pinId);

          if (!element) {
            return;
          }

          const pendingRaf = rafIds.get(pinId);

          if (pendingRaf !== undefined) {
            cancelAnimationFrame(pendingRaf);
            rafIds.delete(pinId);
          }

          element.style.transition = '';
          element.style.transform = '';
        });
      } else {
        // Pass 1: cancel any in-flight cleanup and clear each displaced tile's
        // transform so its settled layout box can be measured cleanly.
        const displaced: { element: HTMLLIElement; pinId: string; previousRect: DOMRect }[] = [];

        previousRects.forEach((previousRect, pinId) => {
          if (pinId === drag.pinId) {
            return;
          }

          const element = pinElementsRef.current.get(pinId);

          if (!element) {
            return;
          }

          const pendingRaf = rafIds.get(pinId);

          if (pendingRaf !== undefined) {
            cancelAnimationFrame(pendingRaf);
            rafIds.delete(pinId);
          }

          element.style.transition = 'none';
          element.style.transform = '';
          displaced.push({ element, pinId, previousRect });
        });

        // Pass 2: measure the settled layout, invert to the old slot, then animate
        // back to zero on the next frame (one rAF per tile, tracked so it can be
        // cancelled if another reorder lands before it fires).
        for (const { element, pinId, previousRect } of displaced) {
          const nextRect = element.getBoundingClientRect();
          const dx = previousRect.left - nextRect.left;
          const dy = previousRect.top - nextRect.top;

          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
            element.style.transition = '';
            continue;
          }

          element.style.transform = `translate(${dx}px, ${dy}px)`;
          const rafId = requestAnimationFrame(() => {
            rafIds.delete(pinId);
            element.style.transition = '';
            element.style.transform = '';
          });
          rafIds.set(pinId, rafId);
        }
      }

      previousRects.clear();
    }

    applyDragTranslate(lastPointerRef.current.x, lastPointerRef.current.y);
    pendingReorderRef.current = false;
  }, [workingPins]);

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

  const contextMenuKeyboard = useMenuKeyboard({
    getFocusAfterEscape: () => contextMenuFocusTargetRef.current,
    isOpen: !!contextMenu,
    menuRef: contextMenuRef,
    onClose: () => setContextMenu(null),
  });

  // Cancel a pending long-press timer when unmounting so it can't run after disposal.
  useEffect(() => () => clearLongPressTimer(), []);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Translate every final order produced by a drag into a single reorder call:
  // only the dragged pin moves, so placing it relative to its neighbour in the
  // final order reproduces the same array the parent persists.
  function commitOrder(order: DashboardPin[], draggedPinId: string) {
    if (order.every((pin, index) => pin.id === pins[index]?.id)) {
      return;
    }

    const finalIndex = order.findIndex((pin) => pin.id === draggedPinId);

    if (finalIndex === -1) {
      return;
    }

    if (finalIndex === 0) {
      const targetId = order[1]?.id;

      if (targetId) {
        onReorderPin(draggedPinId, targetId, 'before');
      }

      return;
    }

    onReorderPin(draggedPinId, order[finalIndex - 1].id, 'after');
  }

  function finishDrag(commit: boolean) {
    const drag = dragStateRef.current;

    if (drag) {
      const element = pinElementsRef.current.get(drag.pinId);

      if (element) {
        element.style.transition = '';
        element.style.transform = '';
      }

      if (commit && drag.hasReordered && workingPins) {
        commitOrder(workingPins, drag.pinId);
      }
    }

    // Cancel any in-flight FLIP cleanup and settle those tiles to their final slots
    // so a pending rAF can't fire after the drag ends and re-introduce a transform.
    const rafIds = flipRafRef.current;
    rafIds.forEach((rafId, pinId) => {
      cancelAnimationFrame(rafId);
      const element = pinElementsRef.current.get(pinId);

      if (element) {
        element.style.transition = '';
        element.style.transform = '';
      }
    });
    rafIds.clear();

    appliedTranslateRef.current = { x: 0, y: 0 };
    flipPrevRectsRef.current.clear();
    pendingReorderRef.current = false;
    dragStateRef.current = null;
    setDraggedPinId(null);
    setWorkingPins(null);
    clearLongPressTimer();
  }

  // Keep the dragged tile glued under the pointer. The tile stays a grid item, so
  // its untransformed layout box moves whenever the grid reorders; we recover that
  // box from the live rect minus the transform we last applied, then clamp the new
  // transform so the tile can never leave the list (never floats off-window).
  function applyDragTranslate(pointerX: number, pointerY: number) {
    const drag = dragStateRef.current;
    const element = drag ? pinElementsRef.current.get(drag.pinId) : null;
    const listRect = drag?.listRect;

    if (!drag || !element || !listRect) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const applied = appliedTranslateRef.current;
    const layoutLeft = rect.left - applied.x;
    const layoutTop = rect.top - applied.y;

    const desiredX = pointerX - drag.grabOffsetX - layoutLeft;
    const desiredY = pointerY - drag.grabOffsetY - layoutTop;

    const nextX = clampValue(desiredX, listRect.left - layoutLeft, listRect.right - rect.width - layoutLeft);
    const nextY = clampValue(desiredY, listRect.top - layoutTop, listRect.bottom - rect.height - layoutTop);

    element.style.transform = `translate(${nextX}px, ${nextY}px)`;
    appliedTranslateRef.current = { x: nextX, y: nextY };
  }

  function recordFlipPrevRects() {
    const rects = flipPrevRectsRef.current;
    rects.clear();
    pinElementsRef.current.forEach((element, pinId) => {
      rects.set(pinId, element.getBoundingClientRect());
    });
  }

  function beginVisualDrag(drag: NonNullable<typeof dragStateRef.current>) {
    clearLongPressTimer();

    // Capture the clamp bounds once at lift-off: re-reading the list rect every
    // move would let a mid-drag container scroll or a transient resize yank the
    // tile. The list does not change size during a drag (the item count is fixed).
    const list = listRef.current;

    if (list) {
      const bounds = list.getBoundingClientRect();
      drag.listRect = { bottom: bounds.bottom, left: bounds.left, right: bounds.right, top: bounds.top };
    }

    setWorkingPins([...pins]);
    setDraggedPinId(drag.pinId);

    const element = pinElementsRef.current.get(drag.pinId);

    if (element) {
      // The dragged tile follows the pointer instantly; the FLIP transition that
      // animates the other tiles must not also lag this one behind the cursor.
      element.style.transition = 'none';
    }
  }

  // Clear the click-suppression flag after the artifact click that follows a drag /
  // long-press has been dispatched, so a later genuine tap is never swallowed.
  function scheduleSuppressionClear() {
    window.setTimeout(() => {
      suppressedClickPinIdRef.current = null;
    }, 0);
  }

  function handleDragCancel() {
    if (!dragStateRef.current) {
      return;
    }

    finishDrag(false);
    scheduleSuppressionClear();
  }

  function openContextMenuAt(
    pinId: string,
    clientX: number,
    clientY: number,
    focusTarget: HTMLElement | null = null,
  ) {
    const rootFontSizePx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const menuWidth = 12 * rootFontSizePx;
    const menuHeight = 6 * rootFontSizePx;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

    contextMenuFocusTargetRef.current = focusTarget;
    setContextMenu({
      pinId,
      x: Math.max(margin, Math.min(clientX, maxX)),
      y: Math.max(margin, Math.min(clientY, maxY)),
    });
  }

  function getReorderTarget(pointerClientX: number, pointerClientY: number, sourcePinId: string) {
    const currentIndex = renderPins.findIndex((pin) => pin.id === sourcePinId);

    if (currentIndex === -1 || renderPins.length < 2) {
      return null;
    }

    const pinsWithoutDragged = renderPins.filter((pin) => pin.id !== sourcePinId);
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
      // Weight vertical distance heavily so the pointer's row wins first, then the
      // nearest tile within it. With the centered wrap layout (e.g. a short, centered
      // last row) a plain Euclidean nearest-center would otherwise snap to a tile in
      // the adjacent row when the pointer is in the empty space beside/below a row.
      const distance = Math.hypot(pointerClientX - centerX, (pointerClientY - centerY) * 4);

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
    const bounds = event.currentTarget.getBoundingClientRect();

    // Visual drag (and the lifted style) only begins once the pointer crosses the
    // movement threshold, so a plain tap or long-press never looks like a drag.
    dragStateRef.current = {
      grabOffsetX: clientX - bounds.left,
      grabOffsetY: clientY - bounds.top,
      hasReordered: false,
      listRect: null,
      pinId,
      pointerId: event.pointerId,
      startX: clientX,
      startY: clientY,
    };
    lastPointerRef.current = { x: clientX, y: clientY };
    appliedTranslateRef.current = { x: 0, y: 0 };
    // Capture on the stable list element, NOT the tile: reordering moves the tile's
    // DOM node, which would drop capture held on the tile and abort the drag after a
    // single reorder. The list never moves, so capture (and the move/up events)
    // survive every reorder.
    listRef.current?.setPointerCapture(event.pointerId);

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const dragState = dragStateRef.current;

      if (dragState && dragState.pinId === pinId && !dragState.hasReordered) {
        suppressedClickPinIdRef.current = pinId;
        dragStateRef.current = null;
        setDraggedPinId(null);
        clearLongPressTimer();
        openContextMenuAt(
          pinId,
          clientX,
          clientY,
          pinElementsRef.current.get(pinId)?.querySelector<HTMLButtonElement>('.dashboard-pin__tile') ?? null,
        );
      }
    }, PIN_LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLUListElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    lastPointerRef.current = { x: event.clientX, y: event.clientY };

    const isDragging = draggedPinId === dragState.pinId;
    const movedEnough =
      isDragging ||
      Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) >=
        PIN_DRAG_START_MIN_DISTANCE_PX;

    if (!movedEnough) {
      return;
    }

    if (!isDragging) {
      beginVisualDrag(dragState);
    }

    applyDragTranslate(event.clientX, event.clientY);

    // At most one reorder per committed render: the next move reads the DOM, which
    // is stale until React flushes this reorder.
    if (pendingReorderRef.current) {
      return;
    }

    const reorderTarget = getReorderTarget(event.clientX, event.clientY, dragState.pinId);

    if (!reorderTarget) {
      return;
    }

    recordFlipPrevRects();
    pendingReorderRef.current = true;
    dragState.hasReordered = true;
    setWorkingPins((current) =>
      reorderDashboardPins(current ?? pins, dragState.pinId, reorderTarget.pinId, reorderTarget.dropPosition),
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLUListElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    // Capture lives on the list, so resolve which tile the gesture belongs to from
    // the drag state rather than the event target.
    const pin = renderPins.find((candidate) => candidate.id === dragState.pinId) ?? null;
    const wasDragging = draggedPinId === dragState.pinId;
    const reordered = dragState.hasReordered;
    // A clean tap (gesture never crossed the drag threshold, not renaming) opens the
    // pin here on pointerup: the browser does not reliably fire a click after the
    // pointer capture used for drag-reorder, so we must not rely on the tile's onClick.
    const isTap = !wasDragging && !renamingPinId;

    if ((reordered || wasDragging || isTap) && pin) {
      // Swallow the click the browser may still synthesize for this pointer.
      suppressedClickPinIdRef.current = pin.id;
    }

    // Commit and reset before releasing capture so the lost-capture handler no-ops.
    finishDrag(reordered);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    scheduleSuppressionClear();

    if (isTap && pin) {
      onOpenPin(pin);
    }
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLLIElement>, pinId: string) {
    // While renaming, leave the native context menu intact (e.g. paste into the input).
    if (renamingPinId) {
      return;
    }

    event.preventDefault();
    finishDrag(false);
    openContextMenuAt(
      pinId,
      event.clientX,
      event.clientY,
      event.currentTarget.querySelector<HTMLButtonElement>('.dashboard-pin__tile'),
    );
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
    <section className="dashboard-pins" aria-label={t('dashboard.pins')} ref={sectionRef}>
      <h2 className="dashboard-pins__title">{t('dashboard.pins')}</h2>
      <ul
        className="dashboard-pins__list"
        ref={listRef}
        style={{ maxWidth: listMaxWidth }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleDragCancel}
        onLostPointerCapture={handleDragCancel}
      >
        {renderPins.map((pin) => {
          const display = getDashboardPinDisplay(pin);
          const iconResolution = iconResolutions.get(pin.id) ?? null;
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
                    openContextMenuAt(pin.id, bounds.left, bounds.bottom, event.currentTarget);
                  }
                }}
              >
                {iconResolution ? (
                  <AppIcon resolution={iconResolution} size={42} variant="pin" />
                ) : (
                  <display.Icon aria-hidden="true" size={32} strokeWidth={2} />
                )}
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
          onKeyDown={contextMenuKeyboard.onKeyDown}
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
  connectionRefreshEpoch,
  coreManager,
  dashboardPins,
  isLoadingAccounts,
  nodeApiUrl,
  nodeEpoch,
  nodeSettings,
  onChainCoreUpdate,
  onResolvedNodeApiUrl,
  onSaveNodeSettings,
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
          nodeApiUrl={nodeApiUrl}
          nodeEpoch={nodeEpoch}
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
            connectionRefreshEpoch={connectionRefreshEpoch}
            coreManager={coreManager}
            nodeApiUrl={nodeApiUrl}
            nodeSettings={nodeSettings}
            onChainCoreUpdate={onChainCoreUpdate}
            onOpenSettingsSection={onOpenSettingsSection}
            onResolvedNodeApiUrl={onResolvedNodeApiUrl}
            onSaveNodeSettings={onSaveNodeSettings}
          />
        ) : null}
        <HomeUpdateDashboardCard
          canManageTransports={nodeSettings.mode !== 'network'}
          connectionRefreshEpoch={connectionRefreshEpoch}
          isManagedNode={nodeSettings.mode === 'local'}
          nodeApiUrl={nodeApiUrl}
          updates={appUpdates}
          onOpenSettingsSection={onOpenSettingsSection}
        />
      </div>
    </div>
  );
}
